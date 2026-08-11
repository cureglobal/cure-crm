"use client";

import { useMemo, useState } from "react";
import KanbanBoard, { type KanbanDeal } from "@/components/KanbanBoard";
import DealsTable, { type DealRow } from "@/components/DealsTable";
import { Columns3, List, Search, Layers, CircleDot } from "lucide-react";

export interface OwnerOption {
  id: number;
  name: string;
}

type DatePreset = "alle" | "forfalt" | "idag" | "uke" | "egendefinert";

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekRange(): [string, string] {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // mandag = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return [fmt(monday), fmt(sunday)];
}

export default function PipelineView({
  rows,
  owners,
  initialView,
  initialDatePreset = "alle",
  initialOwnerId = "alle",
  initialGroupByStage = false,
  initialOnlyActive = false,
}: {
  rows: DealRow[];
  owners: OwnerOption[];
  initialView: "kanban" | "liste";
  initialDatePreset?: DatePreset;
  initialOwnerId?: "alle" | number;
  initialGroupByStage?: boolean;
  initialOnlyActive?: boolean;
}) {
  const [view, setView] = useState<"kanban" | "liste">(initialView);
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState<"alle" | number>(initialOwnerId);
  const [datePreset, setDatePreset] = useState<DatePreset>(initialDatePreset);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [groupByStage, setGroupByStage] = useState(initialGroupByStage);
  const [onlyActive, setOnlyActive] = useState(initialOnlyActive);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayStr();
    const [monday, sunday] = weekRange();

    return rows.filter((r) => {
      if (ownerId !== "alle" && r.ownerId !== ownerId) return false;
      if (onlyActive && (r.stage === "vunnet" || r.stage === "tapt")) return false;

      if (q) {
        const haystack = `${r.companyName} ${r.title} ${r.comment} ${r.ownerName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (datePreset !== "alle") {
        const d = r.followUpInput; // yyyy-mm-dd eller ""
        if (!d) return false;
        if (datePreset === "idag" && d !== today) return false;
        if (datePreset === "forfalt" && d >= today) return false;
        if (datePreset === "uke" && (d < monday || d > sunday)) return false;
        if (datePreset === "egendefinert") {
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
        }
      }
      return true;
    });
  }, [rows, search, ownerId, datePreset, fromDate, toDate, onlyActive]);

  const kanbanItems: KanbanDeal[] = useMemo(
    () =>
      filtered.map((r) => ({
        id: r.id,
        title: r.title,
        companyName: r.companyName,
        logoUrl: r.logoUrl,
        stage: r.stage,
        value: r.value,
        followUpAt: r.followUpAt,
        ownerName: r.ownerName,
      })),
    [filtered]
  );

  const selectClass = "field !w-auto !rounded-full !py-1.5 pr-7 text-[12.5px]";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-black/[0.05] p-1">
          <button
            onClick={() => setView("kanban")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              view === "kanban" ? "bg-white shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Columns3 size={13} />
            Tavle
          </button>
          <button
            onClick={() => setView("liste")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              view === "liste" ? "bg-white shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            <List size={13} />
            Liste
          </button>
        </div>

        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Søk i selskap, deal, kommentar …"
            className="field w-[230px] !rounded-full !py-1.5 !pl-8 text-[12.5px]"
          />
        </div>

        <select
          value={ownerId === "alle" ? "alle" : String(ownerId)}
          onChange={(e) =>
            setOwnerId(e.target.value === "alle" ? "alle" : Number(e.target.value))
          }
          className={selectClass}
        >
          <option value="alle">Alle eiere</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        <select
          value={datePreset}
          onChange={(e) => setDatePreset(e.target.value as DatePreset)}
          className={selectClass}
        >
          <option value="alle">Alle datoer</option>
          <option value="forfalt">Forfalt</option>
          <option value="idag">I dag</option>
          <option value="uke">Denne uken</option>
          <option value="egendefinert">Fra–til …</option>
        </select>

        {datePreset === "egendefinert" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
            />
            <span className="text-[12px] text-ink-faint">–</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
            />
          </div>
        )}

        <button
          onClick={() => setOnlyActive((v) => !v)}
          title="Skjul vunne og tapte deals"
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
            onlyActive
              ? "bg-accent-soft text-accent"
              : "bg-black/[0.05] text-ink-soft hover:text-ink"
          }`}
        >
          <CircleDot size={13} />
          Bare aktive
        </button>

        {view === "liste" && (
          <button
            onClick={() => setGroupByStage((g) => !g)}
            className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              groupByStage
                ? "bg-accent-soft text-accent"
                : "bg-black/[0.05] text-ink-soft hover:text-ink"
            }`}
          >
            <Layers size={13} />
            Grupper på fase
          </button>
        )}
      </div>

      {(search || ownerId !== "alle" || datePreset !== "alle" || onlyActive) && (
        <p className="mb-3 text-[12.5px] text-ink-faint">
          Viser {filtered.length} av {rows.length} deals
        </p>
      )}

      {view === "kanban" ? (
        <KanbanBoard deals={kanbanItems} />
      ) : (
        <DealsTable rows={filtered} groupByStage={groupByStage} />
      )}
    </div>
  );
}
