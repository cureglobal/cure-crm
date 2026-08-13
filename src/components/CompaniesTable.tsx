"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import CompanyLogo from "@/components/CompanyLogo";
import {
  ArrowDown,
  ArrowUp,
  Search,
  Users,
  Briefcase,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

export interface CompanyRow {
  id: number;
  name: string;
  orgName: string | null;
  orgNumber: string | null;
  brregVerified: boolean;
  logoUrl: string | null;
  website: string | null;
  dealCount: number;
  openCount: number;
  openValue: number;
  wonValue: number;
  people: string[];
}

const GRID = "grid grid-cols-[1.8fr_110px_70px_1fr_1fr_1.3fr] items-center gap-3";

type SortKey = "navn" | "orgnr" | "deals" | "apen" | "vunnet" | "personer";
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  navn: 1,
  orgnr: 1,
  deals: -1,
  apen: -1,
  vunnet: -1,
  personer: -1,
};

function formatOrgNumber(org: string | null): string {
  if (!org) return "";
  return org.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

function HeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 } | null;
  onSort: (k: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition hover:text-ink ${
        active ? "text-ink" : "text-ink-faint"
      } ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : ""}`}
    >
      {label}
      {active &&
        (sort!.dir === 1 ? (
          <ArrowUp size={11} strokeWidth={2.5} />
        ) : (
          <ArrowDown size={11} strokeWidth={2.5} />
        ))}
    </button>
  );
}

export default function CompaniesTable({
  rows,
  totalOpen,
  totalWon,
}: {
  rows: CompanyRow[];
  totalOpen: number;
  totalWon: number;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>({
    key: "navn",
    dir: 1,
  });

  function onSort(key: SortKey) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: DEFAULT_DIR[key] }
    );
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.orgName ?? "").toLowerCase().includes(q) ||
            (r.orgNumber ?? "").replace(/\s/g, "").includes(q.replace(/\s/g, "")) ||
            r.people.some((p) => p.toLowerCase().includes(q))
        )
      : rows;
    if (sort) {
      const dir = sort.dir;
      list = [...list].sort((a, b) => {
        switch (sort.key) {
          case "navn":
            return dir * a.name.localeCompare(b.name, "nb");
          case "orgnr":
            // Ubekreftede først når man sorterer på orgnr stigende.
            return dir * ((a.orgNumber ?? "").localeCompare(b.orgNumber ?? "", "nb"));
          case "deals":
            return dir * (a.dealCount - b.dealCount);
          case "apen":
            return dir * (a.openValue - b.openValue);
          case "vunnet":
            return dir * (a.wonValue - b.wonValue);
          case "personer":
            return dir * (a.people.length - b.people.length);
        }
      });
    }
    return list;
  }, [rows, search, sort]);

  const stats = [
    { label: "Selskaper", value: String(rows.length), icon: <Briefcase size={16} /> },
    { label: "Åpen pipeline", value: formatMoney(totalOpen), icon: <TrendingUp size={16} /> },
    { label: "Vunnet verdi", value: formatMoney(totalWon), icon: <Users size={16} /> },
  ];

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
              {s.icon}
            </div>
            <p className="text-[22px] font-semibold tracking-tight">{s.value}</p>
            <p className="text-[12.5px] text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 relative w-[280px]">
        <Search
          size={13}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk i selskap eller person …"
          className="field !rounded-full !py-1.5 !pl-8 text-[12.5px]"
        />
      </div>

      <div className="card overflow-auto max-h-[75vh]">
        <div className="min-w-[820px]">
        <div
          className={`${GRID} sticky top-0 z-20 rounded-t-[17px] border-b border-line bg-surface/95 px-5 py-2.5 backdrop-blur-xl`}
        >
          <HeaderCell label="Selskap" sortKey="navn" sort={sort} onSort={onSort} />
          <HeaderCell label="Org nr" sortKey="orgnr" sort={sort} onSort={onSort} />
          <HeaderCell label="Deals" sortKey="deals" sort={sort} onSort={onSort} align="center" />
          <span className="flex justify-end">
            <HeaderCell label="Åpen verdi" sortKey="apen" sort={sort} onSort={onSort} align="right" />
          </span>
          <span className="flex justify-end">
            <HeaderCell label="Vunnet" sortKey="vunnet" sort={sort} onSort={onSort} align="right" />
          </span>
          <span className="px-2">
            <HeaderCell label="Personer" sortKey="personer" sort={sort} onSort={onSort} />
          </span>
        </div>

        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-ink-faint">
            Ingen selskaper matcher søket.
          </p>
        ) : (
          <ul>
            {visible.map((c) => (
              <li key={c.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`/companies/${c.id}`}
                  className={`${GRID} px-5 py-3 transition hover:bg-mist/[0.02]`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <CompanyLogo logoUrl={c.logoUrl} name={c.name} size={32} radius={9} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-medium">{c.name}</span>
                        {!c.brregVerified && (
                          <TriangleAlert
                            size={12}
                            className="shrink-0 text-warning-ink"
                            aria-label="Ikke bekreftet"
                          />
                        )}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-soft">
                        {c.orgName && c.orgName !== c.name
                          ? c.orgName
                          : c.website
                            ? c.website.replace(/^https?:\/\//, "")
                            : ""}
                      </span>
                    </span>
                  </span>
                  <span className="text-[12.5px] tabular-nums text-ink-soft">
                    {c.orgNumber ? (
                      formatOrgNumber(c.orgNumber)
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </span>
                  <span className="text-center text-[13px] tabular-nums">
                    {c.dealCount}
                    {c.openCount > 0 && c.openCount !== c.dealCount && (
                      <span className="text-ink-faint"> ({c.openCount} åpne)</span>
                    )}
                  </span>
                  <span className="text-right text-[13px] font-medium tabular-nums">
                    {c.openValue > 0 ? formatMoney(c.openValue) : "—"}
                  </span>
                  <span className="text-right text-[13px] tabular-nums text-ink-soft">
                    {c.wonValue > 0 ? formatMoney(c.wonValue) : "—"}
                  </span>
                  <span className="truncate px-2 text-[12.5px] text-ink-soft">
                    {c.people.length > 0 ? c.people.join(", ") : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
    </div>
  );
}
