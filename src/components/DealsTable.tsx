"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { updateDealInline } from "@/lib/actions";
import { formatMoney } from "@/lib/format";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import { stageDot, stageLabel, type Stage } from "@/lib/stages";
import { ArrowDown, ArrowUp } from "lucide-react";

export interface DealRow {
  id: number;
  companyName: string;
  logoUrl: string | null;
  ownerId: number;
  ownerName: string;
  coOwnerIds: number[];
  title: string;
  stage: string;
  value: number | null;
  hasLines: boolean;
  updatedAt: number;
  followUpAt: number | null;
  followUpInput: string; // yyyy-mm-dd
  comment: string;
}

const GRID = "grid grid-cols-[1.6fr_60px_1.4fr_0.9fr_150px_1.6fr] items-center gap-3";

type SortKey = "selskap" | "eier" | "deal" | "verdi" | "dato" | "kommentar";
interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

// Standard retning ved første klikk: verdi høy→lav, resten stigende.
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  selskap: 1,
  eier: 1,
  deal: 1,
  verdi: -1,
  dato: 1,
  kommentar: 1,
};

function compare(a: DealRow, b: DealRow, sort: Sort): number {
  const dir = sort.dir;
  switch (sort.key) {
    case "selskap":
      return dir * a.companyName.localeCompare(b.companyName, "nb");
    case "eier":
      return dir * a.ownerName.localeCompare(b.ownerName, "nb");
    case "deal":
      return dir * a.title.localeCompare(b.title, "nb");
    case "verdi":
      return dir * ((a.value ?? -1) - (b.value ?? -1));
    case "dato": {
      // Deals uten dato havner alltid nederst.
      const av = a.followUpAt ?? (sort.dir === 1 ? Infinity : -Infinity);
      const bv = b.followUpAt ?? (sort.dir === 1 ? Infinity : -Infinity);
      return dir * (av - bv);
    }
    case "kommentar":
      return dir * a.comment.localeCompare(b.comment, "nb");
  }
}

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Row({ deal, stages }: { deal: DealRow; stages: Stage[] }) {
  const [pending, startTransition] = useTransition();
  const [dateVal, setDateVal] = useState(deal.followUpInput);
  const overdue = dateVal !== "" && dateVal < todayStr();

  function save(field: string, value: string) {
    const data = new FormData();
    data.set(field, value);
    startTransition(async () => {
      await updateDealInline(deal.id, data);
    });
  }

  return (
    <li
      className={`border-b border-line last:border-b-0 ${pending ? "opacity-60" : ""}`}
    >
      <div className={`${GRID} px-5 py-2.5 transition hover:bg-mist/[0.015]`}>
        <Link href={`/leads/${deal.id}`} className="flex min-w-0 items-center gap-3">
          <CompanyLogo logoUrl={deal.logoUrl} name={deal.companyName} size={32} radius={9} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium hover:text-accent">
              {deal.companyName}
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: stageDot(stages, deal.stage) }}
              />
              {stageLabel(stages, deal.stage)}
            </span>
          </span>
        </Link>

        <span className="relative flex justify-center">
          <Avatar name={deal.ownerName} size={28} />
          {deal.coOwnerIds.length > 0 && (
            <span
              title={`${deal.coOwnerIds.length} med-eier${deal.coOwnerIds.length === 1 ? "" : "e"}`}
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-mist/[0.08] text-[9px] font-semibold text-ink-soft"
            >
              +{deal.coOwnerIds.length}
            </span>
          )}
        </span>

        <input
          defaultValue={deal.title}
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value.trim() !== deal.title) {
              save("title", e.target.value.trim());
            }
          }}
          className="field !border-transparent !bg-transparent !px-2 !py-1.5 text-[13px] font-medium hover:!border-line focus:!border-accent focus:!bg-surface"
        />

        {deal.hasLines ? (
          <span
            className="px-2 text-right text-[13px] font-medium tabular-nums text-ink-soft"
            title="Beregnes fra varelinjene"
          >
            {formatMoney(deal.value)}
          </span>
        ) : (
          <input
            defaultValue={deal.value ?? ""}
            inputMode="numeric"
            placeholder="—"
            onBlur={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, "");
              if ((raw ? Number(raw) : null) !== deal.value) save("value", raw);
            }}
            className="field !border-transparent !bg-transparent !px-2 !py-1.5 text-right text-[13px] font-medium tabular-nums hover:!border-line focus:!border-accent focus:!bg-surface"
          />
        )}

        <input
          type="date"
          value={dateVal}
          onChange={(e) => {
            setDateVal(e.target.value);
            save("followUpAt", e.target.value);
          }}
          className={`field !border-transparent !bg-transparent !px-2 !py-1.5 text-[12.5px] hover:!border-line focus:!border-accent focus:!bg-surface ${
            overdue ? "!font-medium !text-danger" : ""
          }`}
        />

        <input
          defaultValue={deal.comment}
          placeholder="Legg til kommentar …"
          onBlur={(e) => {
            if (e.target.value.trim() !== deal.comment) {
              save("comment", e.target.value.trim());
            }
          }}
          className="field !border-transparent !bg-transparent !px-2 !py-1.5 text-[13px] text-ink-soft hover:!border-line focus:!border-accent focus:!bg-surface focus:text-ink"
        />
      </div>
    </li>
  );
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
  sort: Sort | null;
  onSort: (key: SortKey) => void;
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
        (sort!.dir === 1 ? <ArrowUp size={11} strokeWidth={2.5} /> : <ArrowDown size={11} strokeWidth={2.5} />)}
    </button>
  );
}

export default function DealsTable({
  rows,
  stages,
  groupByStage = false,
}: {
  rows: DealRow[];
  stages: Stage[];
  groupByStage?: boolean;
}) {
  const [sort, setSort] = useState<Sort | null>(null);

  function onSort(key: SortKey) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: DEFAULT_DIR[key] }
    );
  }

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => compare(a, b, sort));
  }, [rows, sort]);

  const groups = useMemo(() => {
    if (!groupByStage) return null;
    return stages
      .map((s) => ({
        stage: s,
        items: sorted.filter((r) => r.stage === String(s.id)),
      }))
      .filter((g) => g.items.length > 0);
  }, [sorted, groupByStage, stages]);

  const header = (
    <div
      className={`${GRID} sticky top-0 z-20 rounded-t-[17px] border-b border-line bg-surface/95 px-5 py-2.5 backdrop-blur-xl`}
    >
      <HeaderCell label="Selskap" sortKey="selskap" sort={sort} onSort={onSort} />
      <HeaderCell label="Eier" sortKey="eier" sort={sort} onSort={onSort} align="center" />
      <span className="px-2">
        <HeaderCell label="Deal" sortKey="deal" sort={sort} onSort={onSort} />
      </span>
      <span className="flex justify-end px-2">
        <HeaderCell label="Verdi" sortKey="verdi" sort={sort} onSort={onSort} align="right" />
      </span>
      <span className="px-2">
        <HeaderCell label="Dato" sortKey="dato" sort={sort} onSort={onSort} />
      </span>
      <span className="px-2">
        <HeaderCell label="Kommentar" sortKey="kommentar" sort={sort} onSort={onSort} />
      </span>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="card overflow-auto max-h-[75vh]">
        <div className="min-w-[880px]">
          {header}
          <p className="px-5 py-10 text-center text-[13px] text-ink-faint">
            Ingen deals matcher filtrene.
          </p>
        </div>
      </div>
    );
  }

  // NB: ingen overflow-hidden på kortet — det bryter sticky-posisjonering på kolonneraden.
  // overflow-x-auto er trygt fordi kortet ikke har en fast høyde: innholdet
  // overgår aldri boksens egen høyde, så det oppstår aldri vertikal scroll her
  // — bare horisontal, når skalering/zoom gjør kolonnene trangere enn min-bredden.
  return (
    <div className="card overflow-auto max-h-[75vh]">
      <div className="min-w-[880px]">
        {header}
        {groups ? (
          groups.map((g) => {
            const sum = g.items.reduce((acc, r) => acc + (r.value ?? 0), 0);
            return (
              <div key={g.stage.id}>
                <div className="sticky top-[41px] z-10 flex items-center gap-2 border-b border-line bg-canvas/95 px-5 py-2 backdrop-blur-xl">
                  <span className="h-2 w-2 rounded-full" style={{ background: g.stage.color }} />
                  <span className="text-[12.5px] font-semibold">{g.stage.label}</span>
                  <span className="text-[12px] text-ink-faint">{g.items.length}</span>
                  {sum > 0 && (
                    <span className="ml-auto text-[12px] tabular-nums text-ink-soft">
                      {formatMoney(sum)}
                    </span>
                  )}
                </div>
                <ul>
                  {g.items.map((deal) => (
                    <Row key={deal.id} deal={deal} stages={stages} />
                  ))}
                </ul>
              </div>
            );
          })
        ) : (
          <ul>
            {sorted.map((deal) => (
              <Row key={deal.id} deal={deal} stages={stages} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
