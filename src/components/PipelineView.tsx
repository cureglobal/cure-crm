"use client";

import { useEffect, useMemo, useState } from "react";
import KanbanBoard, { type KanbanDeal } from "@/components/KanbanBoard";
import DealsTable, { type DealRow } from "@/components/DealsTable";
import { Columns3, List, Search, Layers, CircleDot } from "lucide-react";

export interface OwnerOption {
  id: number;
  name: string;
}

type DatePreset = "alle" | "forfalt" | "idag" | "uke" | "egendefinert";

// Husker sist brukte filter i nettleseren, slik at det ligger klart igjen når
// man kommer tilbake fra en annen fane. Eksplisitte URL-parametre (f.eks. fra
// "Se alle" på oversikten) vinner ved lasting, og blir da selv det nye
// "sist valgte" — se applyStored/persist under.
const STORAGE_KEY = "crm:pipeline-filters";
const ACTIVE_DAYS = 45;

interface StoredFilters {
  view?: "kanban" | "liste";
  ownerId?: "alle" | number;
  datePreset?: DatePreset;
  fromDate?: string;
  toDate?: string;
  groupByStage?: boolean;
  onlyActive?: boolean;
}

function readStored(): StoredFilters | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredFilters) : null;
  } catch {
    return null;
  }
}

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function activeCutoffTs(days: number) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
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
  currentUserId,
  initialView,
  initialDatePreset,
  initialOwnerId,
  initialGroupByStage,
  initialOnlyActive,
}: {
  rows: DealRow[];
  owners: OwnerOption[];
  // Brukes som standardeier ("Eier = meg") første gang, før noe er lagret.
  currentUserId: number;
  // Udefinert = ikke satt eksplisitt via URL; da avgjør lagrede preferanser
  // (eller de faste standardverdiene under, ved aller første besøk).
  initialView?: "kanban" | "liste";
  initialDatePreset?: DatePreset;
  initialOwnerId?: "alle" | number;
  initialGroupByStage?: boolean;
  initialOnlyActive?: boolean;
}) {
  // Faste standardverdier ved første besøk noensinne (ingenting lagret ennå):
  // liste, gruppert på fase, eier = meg.
  const [view, setView] = useState<"kanban" | "liste">(initialView ?? "liste");
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState<"alle" | number>(initialOwnerId ?? currentUserId);
  const [datePreset, setDatePreset] = useState<DatePreset>(initialDatePreset ?? "alle");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [groupByStage, setGroupByStage] = useState(initialGroupByStage ?? true);
  const [onlyActive, setOnlyActive] = useState(initialOnlyActive ?? false);

  // Laster lagrede preferanser etter første render (localStorage finnes bare i
  // nettleseren, og lesing under selve renderen ville gitt et hydreringsavvik
  // mot serverens HTML). URL-parametre som eksplisitt ble gitt til komponenten
  // vinner over det som er lagret — det er slik "Se alle"-lenker fra
  // oversikten fungerer.
  //
  // `hydrated` er bevisst React-state og ikke en ref: en ref er umiddelbart
  // synlig (også for lagre-effekten under, i samme flush), så den ville
  // latt lagre-effekten skrive de FØR-innlastede standardverdiene til
  // localStorage — det overskrev nettopp det vi leste inn. State fanges i
  // stedet i det faste øyeblikksbildet til hver render, så lagre-effekten
  // først ser `hydrated=true` i en render der view/eier/osv. allerede
  // reflekterer det innlastede resultatet.
  const [hydrated, setHydrated] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- synkroniserer med
     localStorage (ekstern kilde); må skje etter montering for å unngå
     SSR/klient-avvik, siden localStorage ikke finnes på serveren. */
  useEffect(() => {
    const saved = readStored();
    if (initialView === undefined) setView(saved?.view ?? "liste");
    if (initialOwnerId === undefined) setOwnerId(saved?.ownerId ?? currentUserId);
    if (initialDatePreset === undefined) setDatePreset(saved?.datePreset ?? "alle");
    if (initialGroupByStage === undefined) setGroupByStage(saved?.groupByStage ?? true);
    if (initialOnlyActive === undefined) setOnlyActive(saved?.onlyActive ?? false);
    if (saved?.fromDate) setFromDate(saved.fromDate);
    if (saved?.toDate) setToDate(saved.toDate);
    setHydrated(true);
    // Kjøres bare ved montering — filtrene selv styrer lagring videre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Lagrer alle endringer (også de som kom fra URL) som "sist valgt".
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ view, ownerId, datePreset, fromDate, toDate, groupByStage, onlyActive })
      );
    } catch {
      // Privat nettlesing e.l. — ikke kritisk, filteret gjelder bare denne sesjonen.
    }
  }, [hydrated, view, ownerId, datePreset, fromDate, toDate, groupByStage, onlyActive]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayStr();
    const [monday, sunday] = weekRange();
    const activeCutoff = activeCutoffTs(ACTIVE_DAYS);

    return rows.filter((r) => {
      // En deal regnes som "eid" av en bruker enten som hoved-eier eller som med-eier.
      if (ownerId !== "alle" && r.ownerId !== ownerId && !r.coOwnerIds.includes(ownerId)) {
        return false;
      }
      if (onlyActive && r.updatedAt < activeCutoff) return false;

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
        coOwnerCount: r.coOwnerIds.length,
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
          title={`Skjul deals uten oppdatering de siste ${ACTIVE_DAYS} dagene`}
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
