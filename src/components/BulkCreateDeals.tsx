"use client";

import { useEffect, useState, useTransition } from "react";
import {
  previewBulkDealCompanies,
  bulkCreateDealsForCompanies,
  searchCompaniesAction,
  type DealCompanyPreviewRow,
  type DealCompanyMatch,
} from "@/lib/actions";
import { toDateStr } from "@/components/CalendarPopover";
import { formatOrgNumber } from "@/components/CompanyFacts";
import { Search, Plus } from "lucide-react";

type Resolution = number | "new";

// Fritt søk i vår egen selskapsdatabase for én rad — brukes når de
// automatiske forslagene bommer helt (f.eks. et akronym som "NMF").
function RowCompanySearch({ onPick }: { onPick: (m: DealCompanyMatch) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DealCompanyMatch[]>([]);
  const [searching, startSearch] = useTransition();

  /* eslint-disable react-hooks/set-state-in-effect -- rydder søketreff momentant når input blir for kort */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      startSearch(async () => {
        setHits(await searchCompaniesAction(q));
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
      >
        <Search size={10} />
        Søk selv
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        placeholder="Navn eller orgnr …"
        className="field !py-1 !px-2 text-[12px]"
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {query.trim().length >= 2 && (
        <ul className="absolute left-0 top-full z-30 mt-1 flex max-h-52 w-64 flex-col gap-0.5 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(h);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left transition hover:bg-mist/[0.05]"
              >
                <span className="text-[12.5px] font-medium">{h.name}</span>
                {h.orgNumber && (
                  <span className="text-[11px] text-ink-faint">{formatOrgNumber(h.orgNumber)}</span>
                )}
              </button>
            </li>
          ))}
          {searching && <li className="px-2 py-1.5 text-[12px] text-ink-faint">Søker …</li>}
          {!searching && hits.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-ink-faint">Ingen treff.</li>
          )}
        </ul>
      )}
    </div>
  );
}

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
  const [manualPicks, setManualPicks] = useState<Record<number, DealCompanyMatch>>({});
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
      setManualPicks({});
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
            {preview.map((row, i) => {
              const manualPick = manualPicks[i];
              const options =
                manualPick && !row.matches.some((m) => m.id === manualPick.id)
                  ? [manualPick, ...row.matches]
                  : row.matches;
              return (
                <li
                  key={i}
                  className="grid grid-cols-[1.4fr_1.6fr] items-center gap-3 border-b border-line px-4 py-2 last:border-b-0"
                >
                  <span className="truncate text-[13px]">{row.input}</span>
                  <div className="flex flex-col items-start gap-1">
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
                      {options.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.orgNumber ? ` (${formatOrgNumber(m.orgNumber)})` : ""}
                        </option>
                      ))}
                    </select>
                    <RowCompanySearch
                      onPick={(m) => {
                        setManualPicks((prev) => ({ ...prev, [i]: m }));
                        setResolved((prev) => ({ ...prev, [i]: m.id }));
                      }}
                    />
                  </div>
                </li>
              );
            })}
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
