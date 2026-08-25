"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { updateDealDetails } from "@/lib/actions";
import { formatDate, formatMoney } from "@/lib/format";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import { ArrowDown, ArrowUp, Search, TriangleAlert } from "lucide-react";

export type StatDealsVariant = "sum" | "estimert" | "leadtime" | "leadtimetapt";

export interface StatDealRow {
  id: number;
  slug: string;
  companyName: string;
  logoUrl: string | null;
  dealTitle: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  value: number | null;
  probability: number;
  closedAt: number | null; // vunnet- eller tapt-dato, avhengig av variant
  lostReasonLabel: string | null;
  comment: string | null;
}

type SortKey = "selskap" | "eier" | "sannsynlighet" | "verdi" | "dato";

const DEFAULT_SORT: Record<StatDealsVariant, { key: SortKey; dir: 1 | -1 }> = {
  sum: { key: "verdi", dir: -1 },
  estimert: { key: "verdi", dir: -1 },
  leadtime: { key: "dato", dir: -1 },
  leadtimetapt: { key: "dato", dir: -1 },
};

const GRID: Record<StatDealsVariant, string> = {
  sum: "grid grid-cols-[1fr_180px_140px] items-center gap-3",
  estimert: "grid grid-cols-[1fr_170px_110px_140px] items-center gap-3",
  leadtime: "grid grid-cols-[1fr_150px_90px_120px_120px] items-center gap-3",
  leadtimetapt: "grid grid-cols-[1fr_150px_120px_110px_140px_1.3fr] items-center gap-3",
};

function HeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition hover:text-ink ${
        active ? "text-ink" : "text-ink-faint"
      } ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : ""}`}
    >
      {label}
      {active &&
        (sort.dir === 1 ? <ArrowUp size={11} strokeWidth={2.5} /> : <ArrowDown size={11} strokeWidth={2.5} />)}
    </button>
  );
}

function ProbabilityCell({ row, editable }: { row: StatDealRow; editable: boolean }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(row.probability);

  if (!editable) {
    return <span className="text-right text-[13px] tabular-nums text-ink-soft">{row.probability}%</span>;
  }

  function save(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(n)));
    if (clamped === value) return;
    setValue(clamped);
    const fd = new FormData();
    fd.set("probabilityOverride", String(clamped));
    startTransition(() => updateDealDetails(row.id, fd));
  }

  return (
    <span className={`flex items-center justify-end gap-1 ${pending ? "opacity-60" : ""}`}>
      <input
        type="number"
        min={0}
        max={100}
        defaultValue={value}
        onBlur={(e) => save(e.target.value)}
        className="field !w-14 !py-1 text-right text-[12.5px]"
      />
      <span className="text-[12px] text-ink-faint">%</span>
    </span>
  );
}

export default function StatDealsList({
  rows,
  variant,
  title,
  sublabel,
  totalDisplay,
}: {
  rows: StatDealRow[];
  variant: StatDealsVariant;
  title: string;
  sublabel: string;
  totalDisplay: string;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(DEFAULT_SORT[variant]);

  function onSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? rows.filter(
          (r) =>
            r.companyName.toLowerCase().includes(q) ||
            r.dealTitle.toLowerCase().includes(q) ||
            r.ownerName.toLowerCase().includes(q)
        )
      : rows;
    const dir = sort.dir;
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case "selskap":
          return dir * a.companyName.localeCompare(b.companyName, "nb");
        case "eier":
          return dir * a.ownerName.localeCompare(b.ownerName, "nb");
        case "sannsynlighet":
          return dir * (a.probability - b.probability);
        case "verdi":
          return dir * ((a.value ?? 0) - (b.value ?? 0));
        case "dato":
          return dir * ((a.closedAt ?? 0) - (b.closedAt ?? 0));
      }
    });
    return list;
  }, [rows, search, sort]);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <Link
            href="/statistikk"
            className="mb-1 inline-block text-[12.5px] font-medium text-ink-soft hover:text-ink"
          >
            ← Statistikk
          </Link>
          <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-ink-soft">
            {totalDisplay} · {sublabel}
          </p>
        </div>
      </div>

      <div className="mb-4 relative w-[280px]">
        <Search
          size={13}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk i selskap, deal eller eier …"
          className="field !rounded-full !py-1.5 !pl-8 text-[12.5px]"
        />
      </div>

      <div className="card overflow-auto max-h-[75vh]">
        <div className="min-w-[880px]">
          <div
            className={`${GRID[variant]} sticky top-0 z-20 rounded-t-[17px] border-b border-line bg-surface/95 px-5 py-2.5 backdrop-blur-xl`}
          >
            <HeaderCell label="Selskap" sortKey="selskap" sort={sort} onSort={onSort} />
            <HeaderCell label="Eier" sortKey="eier" sort={sort} onSort={onSort} />
            {(variant === "estimert" || variant === "leadtime") && (
              <HeaderCell
                label="Sannsynlighet"
                sortKey="sannsynlighet"
                sort={sort}
                onSort={onSort}
                align="right"
              />
            )}
            <HeaderCell label="Verdi" sortKey="verdi" sort={sort} onSort={onSort} align="right" />
            {(variant === "leadtime" || variant === "leadtimetapt") && (
              <HeaderCell
                label={variant === "leadtime" ? "Vunnet" : "Tapt"}
                sortKey="dato"
                sort={sort}
                onSort={onSort}
              />
            )}
            {variant === "leadtimetapt" && (
              <>
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  Tapt grunn
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  Kommentar
                </span>
              </>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-ink-faint">
              Ingen deals matcher søket.
            </p>
          ) : (
            <ul>
              {visible.map((r) => (
                <li key={r.id} className={`${GRID[variant]} border-b border-line px-5 py-2.5 last:border-b-0 hover:bg-mist/[0.015]`}>
                  <Link href={`/leads/${r.slug}`} className="flex min-w-0 items-center gap-3">
                    <CompanyLogo logoUrl={r.logoUrl} name={r.companyName} size={32} radius={9} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium hover:text-accent">
                        {r.companyName}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-soft">{r.dealTitle}</span>
                    </span>
                  </Link>
                  {r.ownerName ? (
                    <span className="flex items-center gap-1.5 text-[12.5px]">
                      <Avatar name={r.ownerName} imageUrl={r.ownerAvatarUrl} size={20} />
                      <span className="truncate">{r.ownerName}</span>
                    </span>
                  ) : (
                    <span
                      title="Ingen eier"
                      className="flex items-center gap-1.5 text-[12.5px] text-warning-ink"
                    >
                      <TriangleAlert size={13} />
                      Ingen eier
                    </span>
                  )}
                  {(variant === "estimert" || variant === "leadtime") && (
                    <ProbabilityCell row={r} editable={variant === "estimert"} />
                  )}
                  <span className="text-right text-[13px] font-medium tabular-nums">
                    {r.value ? formatMoney(r.value) : <span className="text-ink-faint">—</span>}
                  </span>
                  {(variant === "leadtime" || variant === "leadtimetapt") && (
                    <span className="text-[12.5px] text-ink-soft">
                      {r.closedAt ? formatDate(new Date(r.closedAt)) : "—"}
                    </span>
                  )}
                  {variant === "leadtimetapt" && (
                    <>
                      <span className="truncate text-[12.5px] text-ink-soft">
                        {r.lostReasonLabel ?? "—"}
                      </span>
                      <span className="truncate text-[12.5px] text-ink-soft" title={r.comment ?? undefined}>
                        {r.comment ?? "—"}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
