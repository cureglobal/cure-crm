"use client";

import { useEffect, useState, useTransition } from "react";
import {
  autoMatchAllCompanies,
  syncCompanyFromBrreg,
  searchBrregAction,
  type UnresolvedCompany,
} from "@/lib/actions";
import type { BrregHit } from "@/lib/brreg";
import { Wand2, Search, Check } from "lucide-react";

function formatOrgNumber(org: string | null): string {
  if (!org) return "—";
  return org.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

function RowSearch({
  company,
  onApplied,
}: {
  company: UnresolvedCompany;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BrregHit[]>([]);
  const [searching, startSearch] = useTransition();
  const [applying, startApply] = useTransition();

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
        setHits(await searchBrregAction(q));
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function apply(orgNumber: string) {
    startApply(async () => {
      await syncCompanyFromBrreg(company.id, orgNumber, { verified: true });
      onApplied();
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {company.candidateOrgNumber && (
          <button
            onClick={() => apply(company.candidateOrgNumber!)}
            disabled={applying}
            className="btn btn-secondary !py-1 !px-2.5 text-[12px]"
          >
            <Check size={12} />
            Bruk
          </button>
        )}
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
        >
          <Search size={11} />
          Søk selv
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        placeholder="Navn eller orgnr …"
        className="field !py-1 !px-2.5 text-[12.5px]"
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {query.trim().length >= 2 && (
        <ul className="absolute left-0 top-full z-30 mt-1 flex max-h-52 w-64 flex-col gap-0.5 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          {hits.map((h) => (
            <li key={h.orgNumber}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(h.orgNumber)}
                disabled={applying}
                className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left transition hover:bg-mist/[0.05]"
              >
                <span className="text-[12.5px] font-medium">{h.name}</span>
                <span className="text-[11px] text-ink-faint">
                  {h.orgNumber}
                  {h.city ? ` · ${h.city}` : ""}
                </span>
              </button>
            </li>
          ))}
          {searching && (
            <li className="px-2 py-1.5 text-[12px] text-ink-faint">Søker …</li>
          )}
          {!searching && hits.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-ink-faint">Ingen treff.</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function BrregMatchAll({ unverified }: { unverified: number }) {
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<{ checked: number; matched: number } | null>(null);
  const [unresolved, setUnresolved] = useState<UnresolvedCompany[]>([]);

  function removeResolved(id: number) {
    setUnresolved((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[12.5px] text-ink-soft">
        {unverified === 0
          ? "Alle selskaper er bekreftet mot Enhetsregisteret."
          : `${unverified} selskaper er ikke bekreftet ennå. Søket bruker navn og nettsidedomene, og lagrer bare treff det er sikkert på.`}
      </p>

      {unverified > 0 && (
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setSummary(null);
              const res = await autoMatchAllCompanies();
              setSummary({ checked: res.checked, matched: res.matched });
              setUnresolved(res.unresolved);
            })
          }
          className="btn btn-secondary"
        >
          <Wand2 size={14} className={pending ? "animate-pulse" : ""} />
          {pending ? "Søker i Enhetsregisteret …" : `Match ${unverified} selskaper`}
        </button>
      )}

      {summary && (
        <p className="rounded-xl bg-success/10 px-4 py-2.5 text-[13px] font-medium text-success-ink">
          {summary.matched} av {summary.checked} selskaper ble bekreftet automatisk.
        </p>
      )}

      {unresolved.length > 0 && (
        <div className="w-full rounded-xl border border-line">
          <div className="grid grid-cols-[1.3fr_1.3fr_110px_1fr] gap-3 border-b border-line bg-mist/[0.03] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            <span>Navn</span>
            <span>Orgnavn</span>
            <span>Orgnr</span>
            <span>Velg treff</span>
          </div>
          <ul>
            {unresolved.map((u) => (
              <li
                key={u.id}
                className="grid grid-cols-[1.3fr_1.3fr_110px_1fr] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <span className="truncate text-[13px] font-medium">{u.name}</span>
                <span className="truncate text-[12.5px] text-ink-soft">
                  {u.candidateOrgName ?? "—"}
                </span>
                <span className="text-[12px] tabular-nums text-ink-soft">
                  {formatOrgNumber(u.candidateOrgNumber)}
                </span>
                <RowSearch company={u} onApplied={() => removeResolved(u.id)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
