"use client";

import { useState, useTransition } from "react";
import {
  previewBulkDealCompanies,
  bulkCreateDealsForCompanies,
  type DealCompanyPreviewRow,
} from "@/lib/actions";
import { toDateStr } from "@/components/CalendarPopover";
import { formatOrgNumber } from "@/components/CompanyFacts";
import { Search, Plus } from "lucide-react";

type Resolution = number | "new";

export default function BulkCreateDeals({
  owners,
  currentUserId,
}: {
  owners: { id: number; name: string }[];
  currentUserId: number;
}) {
  const [title, setTitle] = useState("");
  const [namesText, setNamesText] = useState("");
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [coOwnerId, setCoOwnerId] = useState<number | "">("");
  const [followUpAt, setFollowUpAt] = useState(() => toDateStr(new Date()));

  const [preview, setPreview] = useState<DealCompanyPreviewRow[] | null>(null);
  const [resolved, setResolved] = useState<Record<number, Resolution>>({});
  const [searching, startSearch] = useTransition();
  const [creating, startCreate] = useTransition();
  const [result, setResult] = useState<{ created: number; companiesCreated: number } | null>(
    null
  );

  function parseNames(): string[] {
    return namesText
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
  }

  function findCompanies() {
    const names = parseNames();
    if (names.length === 0) return;
    setResult(null);
    startSearch(async () => {
      const rows = await previewBulkDealCompanies(names);
      setPreview(rows);
      const next: Record<number, Resolution> = {};
      rows.forEach((row, i) => {
        next[i] = row.matches.length > 0 ? row.matches[0].id : "new";
      });
      setResolved(next);
    });
  }

  function create() {
    if (!preview) return;
    const items = preview.map((row, i) => ({
      name: row.input,
      companyId: resolved[i] === "new" ? null : (resolved[i] as number),
    }));
    startCreate(async () => {
      const coOwnerIds = coOwnerId ? [coOwnerId] : [];
      const res = await bulkCreateDealsForCompanies(items, title, ownerId, coOwnerIds, followUpAt);
      setResult(res);
      setPreview(null);
      setNamesText("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="text-[12px] font-medium text-ink-soft">
          Tittel på deal
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="F.eks. Placebo"
            className="field mt-1"
          />
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          Oppfølgingsdato
          <input
            type="date"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className="field mt-1"
          />
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          Eier
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(Number(e.target.value))}
            className="field mt-1"
          >
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          Med-eier (valgfritt)
          <select
            value={coOwnerId}
            onChange={(e) => setCoOwnerId(e.target.value ? Number(e.target.value) : "")}
            className="field mt-1"
          >
            <option value="">Ingen</option>
            {owners
              .filter((o) => o.id !== ownerId)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <label className="text-[12px] font-medium text-ink-soft">
        Selskapsnavn (ett per linje)
        <textarea
          value={namesText}
          onChange={(e) => {
            setNamesText(e.target.value);
            setPreview(null);
          }}
          rows={6}
          placeholder={"Firma AS\nEt annet firma\n…"}
          className="field mt-1 resize-y"
        />
      </label>

      <button
        onClick={findCompanies}
        disabled={searching || parseNames().length === 0}
        className="btn btn-secondary self-start"
      >
        <Search size={14} className={searching ? "animate-pulse" : ""} />
        {searching ? "Søker …" : "Finn selskaper"}
      </button>

      {preview && (
        <div className="w-full rounded-xl border border-line">
          <div className="grid grid-cols-[1.4fr_1.6fr] gap-3 border-b border-line bg-mist/[0.03] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            <span>Fra listen</span>
            <span>Selskap</span>
          </div>
          <ul>
            {preview.map((row, i) => (
              <li
                key={i}
                className="grid grid-cols-[1.4fr_1.6fr] items-center gap-3 border-b border-line px-4 py-2 last:border-b-0"
              >
                <span className="truncate text-[13px]">{row.input}</span>
                <select
                  value={String(resolved[i] ?? "new")}
                  onChange={(e) =>
                    setResolved((prev) => ({
                      ...prev,
                      [i]: e.target.value === "new" ? "new" : Number(e.target.value),
                    }))
                  }
                  className="field !py-1 text-[12.5px]"
                >
                  <option value="new">Opprett nytt selskap</option>
                  {row.matches.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.orgNumber ? ` (${formatOrgNumber(m.orgNumber)})` : ""}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <button onClick={create} disabled={creating} className="btn btn-primary self-start">
          <Plus size={14} />
          {creating ? "Oppretter …" : `Opprett ${preview.length} deals`}
        </button>
      )}

      {result && (
        <p className="rounded-xl bg-success/10 px-4 py-2.5 text-[13px] font-medium text-success-ink">
          Opprettet {result.created} deals
          {result.companiesCreated > 0 && ` (${result.companiesCreated} nye selskaper)`}.
        </p>
      )}
    </div>
  );
}
