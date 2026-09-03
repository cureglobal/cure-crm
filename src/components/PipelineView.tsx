"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import KanbanBoard, { type KanbanDeal } from "@/components/KanbanBoard";
import DealsTable, { type DealRow } from "@/components/DealsTable";
import NewDealButton from "@/components/NewDealButton";
import SavedViewsMenu from "@/components/SavedViewsMenu";
import type { LostReasonOption } from "@/components/LostReasonDialog";
import type { SavedViewFilters } from "@/lib/actions";
import type { Stage } from "@/lib/stages";
import {
  Columns3,
  List,
  Search,
  Layers,
  CircleDot,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";

export interface OwnerOption {
  id: number;
  name: string;
  avatarDataUrl: string | null;
}

export interface BusinessUnitOption {
  id: number;
  name: string;
}

type DatePreset = "alle" | "forfalt" | "idag" | "uke" | "neste7" | "egendefinert";

// Husker sist brukte filter i nettleseren, slik at det ligger klart igjen når
// man kommer tilbake fra en annen fane. Eksplisitte URL-parametre (f.eks. fra
// "Se alle" på oversikten, eller en lagret visning) vinner ved lasting, og
// blir da selv det nye "sist valgte" — se applyStored/persist under. Utover
// dette skrives gjeldende filtertilstand fortløpende til URL-en (se
// syncToUrl-effekten), slik at enhver filtrert visning er delbar ved å
// kopiere adressefeltet.
const STORAGE_KEY = "crm:pipeline-filters";
const ACTIVE_DAYS = 45;

interface StoredFilters {
  view?: "kanban" | "liste";
  search?: string;
  ownerId?: "alle" | "meg" | number;
  businessUnitId?: "alle" | number;
  tagId?: "alle" | number;
  datePreset?: DatePreset;
  fromDate?: string;
  toDate?: string;
  groupByStage?: boolean;
  activeDays?: number | null;
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

// yyyy-mm-dd for "i dag ± N dager" — brukt av "idag"-filteret (siste 7 dager
// og i dag) og "neste7"-filteret (i dag og 7 dager frem).
function offsetDateStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
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
  stages,
  owners,
  businessUnits,
  lostReasons,
  currentUserId,
  companyOptions,
  savedViewName,
  pipelines,
  pipelineId: initialPipelineId,
  tags,
  initialView,
  initialSearch,
  initialDatePreset,
  initialFromDate,
  initialToDate,
  initialOwnerId,
  initialBusinessUnitId,
  initialTagId,
  initialGroupByStage,
  initialActiveDays,
}: {
  rows: DealRow[];
  stages: Stage[];
  owners: OwnerOption[];
  businessUnits: BusinessUnitOption[];
  lostReasons: LostReasonOption[];
  // Brukes som standardeier ("Eier = meg") første gang, før noe er lagret.
  currentUserId: number;
  companyOptions: { id: number; name: string; logoUrl: string | null }[];
  // Navnet på den lagrede visningen man ser på (/leads/visning/[slug]), om noen.
  savedViewName?: string;
  pipelines: { id: number; name: string }[];
  // Alltid en gyldig, server-utledet verdi (standard-pipeline hvis ikke
  // eksplisitt satt via URL/lagret visning) — ikke "initial" i samme
  // forstand som feltene under.
  pipelineId: number;
  tags: { id: number; label: string }[];
  // Udefinert = ikke satt eksplisitt via URL/lagret visning; da avgjør
  // lagrede preferanser (eller de faste standardverdiene under, ved aller
  // første besøk).
  initialView?: "kanban" | "liste";
  initialSearch?: string;
  initialDatePreset?: DatePreset;
  initialFromDate?: string;
  initialToDate?: string;
  initialOwnerId?: "alle" | "meg" | number;
  initialBusinessUnitId?: "alle" | number;
  initialTagId?: "alle" | number;
  initialGroupByStage?: boolean;
  // Udefinert = ikke satt; 0 = eksplisitt av; >0 = filtrer på nettopp så
  // mange dager siden siste oppdatering (se ACTIVE_DAYS for standardverdien
  // "Bare aktive"-knappen selv bruker).
  initialActiveDays?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Faste standardverdier ved første besøk noensinne (ingenting lagret ennå):
  // liste, gruppert på fase, eier = meg.
  const [view, setView] = useState<"kanban" | "liste">(initialView ?? "liste");
  const [search, setSearch] = useState(initialSearch ?? "");
  const [pipelineId, setPipelineId] = useState(initialPipelineId);
  const [ownerId, setOwnerId] = useState<"alle" | "meg" | number>(initialOwnerId ?? "meg");
  const [businessUnitId, setBusinessUnitId] = useState<"alle" | number>(
    initialBusinessUnitId ?? "alle"
  );
  const [tagId, setTagId] = useState<"alle" | number>(initialTagId ?? "alle");
  const [datePreset, setDatePreset] = useState<DatePreset>(initialDatePreset ?? "alle");
  const [fromDate, setFromDate] = useState(initialFromDate ?? "");
  const [toDate, setToDate] = useState(initialToDate ?? "");
  const [groupByStage, setGroupByStage] = useState(initialGroupByStage ?? true);
  // null = av, et tall = "vis bare deals oppdatert de siste N dagene".
  const [activeDays, setActiveDays] = useState<number | null>(
    initialActiveDays === undefined ? null : initialActiveDays || null
  );
  const [filterOpen, setFilterOpen] = useState(false);

  // Laster lagrede preferanser etter første render (localStorage finnes bare i
  // nettleseren, og lesing under selve renderen ville gitt et hydreringsavvik
  // mot serverens HTML). URL-parametre/lagret visning som eksplisitt ble gitt
  // til komponenten vinner over det som er lagret.
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
    if (initialSearch === undefined) setSearch(saved?.search ?? "");
    if (initialOwnerId === undefined) setOwnerId(saved?.ownerId ?? "meg");
    if (initialBusinessUnitId === undefined) setBusinessUnitId(saved?.businessUnitId ?? "alle");
    if (initialTagId === undefined) setTagId(saved?.tagId ?? "alle");
    if (initialDatePreset === undefined) setDatePreset(saved?.datePreset ?? "alle");
    if (initialGroupByStage === undefined) setGroupByStage(saved?.groupByStage ?? true);
    if (initialActiveDays === undefined) setActiveDays(saved?.activeDays ?? null);
    if (initialFromDate === undefined && saved?.fromDate) setFromDate(saved.fromDate);
    if (initialToDate === undefined && saved?.toDate) setToDate(saved.toDate);
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
        JSON.stringify({
          view,
          search,
          ownerId,
          businessUnitId,
          tagId,
          datePreset,
          fromDate,
          toDate,
          groupByStage,
          activeDays,
        })
      );
    } catch {
      // Privat nettlesing e.l. — ikke kritisk, filteret gjelder bare denne sesjonen.
    }
  }, [
    hydrated,
    view,
    search,
    ownerId,
    businessUnitId,
    tagId,
    datePreset,
    fromDate,
    toDate,
    groupByStage,
    activeDays,
  ]);

  // Skriver gjeldende filtertilstand til URL-en (uten å hoppe i scroll),
  // slik at enhver filtrert visning er delbar ved å kopiere adressefeltet —
  // også helt uten å eksplisitt lagre en visning. Kjøres først etter
  // hydrering, slik at vi ikke overskriver en innkommende URL/lagret visning
  // med et før-innlastet standardverdi-øyeblikksbilde.
  useEffect(() => {
    if (!hydrated) return;
    const sp = new URLSearchParams();
    sp.set("view", view);
    if (search) sp.set("s", search);
    sp.set("pipeline", String(pipelineId));
    sp.set("eier", ownerId === "alle" || ownerId === "meg" ? ownerId : String(ownerId));
    sp.set("enhet", businessUnitId === "alle" ? "alle" : String(businessUnitId));
    sp.set("tag", tagId === "alle" ? "alle" : String(tagId));
    sp.set("dato", datePreset);
    if (datePreset === "egendefinert") {
      if (fromDate) sp.set("fra", fromDate);
      if (toDate) sp.set("til", toDate);
    }
    sp.set("aktive", activeDays != null ? String(activeDays) : "0");
    sp.set("gruppe", groupByStage ? "fase" : "flat");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    view,
    search,
    pipelineId,
    ownerId,
    businessUnitId,
    tagId,
    datePreset,
    fromDate,
    toDate,
    activeDays,
    groupByStage,
    pathname,
  ]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayStr();
    const [monday, sunday] = weekRange();
    const activeCutoff = activeDays != null ? activeCutoffTs(activeDays) : null;
    const sevenDaysAgo = offsetDateStr(-7);
    const sevenDaysAhead = offsetDateStr(7);

    const effectiveOwnerId = ownerId === "meg" ? currentUserId : ownerId;

    return rows.filter((r) => {
      // En deal regnes som "eid" av en bruker enten som hoved-eier eller som med-eier.
      if (
        effectiveOwnerId !== "alle" &&
        r.ownerId !== effectiveOwnerId &&
        !r.coOwnerIds.includes(effectiveOwnerId)
      ) {
        return false;
      }
      if (businessUnitId !== "alle" && r.companyBusinessUnitId !== businessUnitId) {
        return false;
      }
      if (tagId !== "alle" && !r.tagIds.includes(tagId)) return false;
      if (activeCutoff != null && r.updatedAt < activeCutoff) return false;

      if (q) {
        const haystack = `${r.companyName} ${r.title} ${r.comment} ${r.ownerName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (datePreset !== "alle") {
        const d = r.followUpInput; // yyyy-mm-dd eller ""
        if (!d) return false;
        // "I dag" viser også de siste 7 dagene, ikke bare eksakt i dag —
        // ellers druknet nylig forfalte oppfølginger i "Alle datoer".
        if (datePreset === "idag" && (d < sevenDaysAgo || d > today)) return false;
        if (datePreset === "forfalt" && d >= today) return false;
        if (datePreset === "uke" && (d < monday || d > sunday)) return false;
        if (datePreset === "neste7" && (d < today || d > sevenDaysAhead)) return false;
        if (datePreset === "egendefinert") {
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
        }
      }
      return true;
    });
  }, [
    rows,
    search,
    ownerId,
    currentUserId,
    businessUnitId,
    tagId,
    datePreset,
    fromDate,
    toDate,
    activeDays,
  ]);

  const kanbanItems: KanbanDeal[] = useMemo(
    () =>
      filtered.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        companyName: r.companyName,
        logoUrl: r.logoUrl,
        stage: r.stage,
        value: r.value,
        followUpAt: r.followUpAt,
        ownerName: r.ownerName,
        ownerAvatarUrl: r.ownerAvatarUrl,
        coOwnerCount: r.coOwnerIds.length,
      })),
    [filtered]
  );

  const selectClass = "field !w-auto !rounded-full !py-1.5 pr-7 text-[12.5px]";

  const activeFilterCount = [
    ownerId !== "alle",
    businessUnitId !== "alle",
    tagId !== "alle",
    datePreset !== "alle",
    activeDays != null,
  ].filter(Boolean).length;

  function resetFilters() {
    setOwnerId("alle");
    setBusinessUnitId("alle");
    setTagId("alle");
    setDatePreset("alle");
    setFromDate("");
    setToDate("");
    setActiveDays(null);
  }

  const currentFilters: SavedViewFilters = {
    view,
    search: search || null,
    pipelineId,
    ownerId: ownerId === "alle" ? -1 : ownerId === "meg" ? -2 : ownerId,
    businessUnitId: businessUnitId === "alle" ? -1 : businessUnitId,
    tagId: tagId === "alle" ? -1 : tagId,
    datePreset,
    fromDate: fromDate || null,
    toDate: toDate || null,
    activeDays: activeDays ?? 0,
    groupByStage,
  };

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">
            Pipeline
            {savedViewName && <span className="text-ink-faint"> · {savedViewName}</span>}
          </h1>
          <p className="mt-1 text-ink-soft">
            Alle deals — filtrer, sorter og rediger rett i tabellen.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <NewDealButton
            companies={companyOptions}
            pipelines={pipelines}
            pipelineId={pipelineId}
            tags={tags}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-mist/[0.05] p-1">
          <button
            onClick={() => setView("kanban")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              view === "kanban" ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Columns3 size={13} />
            Tavle
          </button>
          <button
            onClick={() => setView("liste")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              view === "liste" ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            <List size={13} />
            Liste
          </button>
        </div>

        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
            filterOpen ? "bg-surface shadow-card" : "bg-mist/[0.05] text-ink-soft hover:text-ink"
          }`}
        >
          <SlidersHorizontal size={13} />
          Filtrer
          {activeFilterCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown
            size={13}
            className={`transition-transform ${filterOpen ? "rotate-180" : ""}`}
          />
        </button>

        <SavedViewsMenu
          filters={currentFilters}
          pipelines={pipelines}
          pipelineId={pipelineId}
          onPipelineChange={setPipelineId}
        />

        {view === "liste" && (
          <button
            onClick={() => setGroupByStage((g) => !g)}
            className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              groupByStage
                ? "bg-accent-soft text-accent"
                : "bg-mist/[0.05] text-ink-soft hover:text-ink"
            }`}
          >
            <Layers size={13} />
            Grupper på fase
          </button>
        )}
      </div>

      {filterOpen && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-mist/[0.02] p-3">
          <select
            value={ownerId === "alle" || ownerId === "meg" ? ownerId : String(ownerId)}
            onChange={(e) => {
              const v = e.target.value;
              setOwnerId(v === "alle" || v === "meg" ? v : Number(v));
            }}
            className={selectClass}
            title="«Meg» viser alltid dine egne deals — også når visningen er delt med andre"
          >
            <option value="alle">Alle eiere</option>
            <option value="meg">Meg</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <select
            value={businessUnitId === "alle" ? "alle" : String(businessUnitId)}
            onChange={(e) =>
              setBusinessUnitId(e.target.value === "alle" ? "alle" : Number(e.target.value))
            }
            className={selectClass}
            title="Filtrer på hvilket av våre selskap kunden tilhører"
          >
            <option value="alle">Alle selskap</option>
            {businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          {tags.length > 0 && (
            <select
              value={tagId === "alle" ? "alle" : String(tagId)}
              onChange={(e) => setTagId(e.target.value === "alle" ? "alle" : Number(e.target.value))}
              className={selectClass}
            >
              <option value="alle">Alle tagger</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}

          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className={selectClass}
          >
            <option value="alle">Alle datoer</option>
            <option value="forfalt">Forfalt</option>
            <option value="idag">I dag (siste 7 dager)</option>
            <option value="uke">Denne uken</option>
            <option value="neste7">Neste 7 dager</option>
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
            onClick={() => setActiveDays((v) => (v != null ? null : ACTIVE_DAYS))}
            title={
              activeDays != null
                ? `Skjuler deals uten oppdatering de siste ${activeDays} dagene`
                : `Skjul deals uten oppdatering de siste ${ACTIVE_DAYS} dagene`
            }
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              activeDays != null
                ? "bg-accent-soft text-accent"
                : "bg-mist/[0.05] text-ink-soft hover:text-ink"
            }`}
          >
            <CircleDot size={13} />
            {activeDays != null && activeDays !== ACTIVE_DAYS
              ? `Aktiv siste ${activeDays} dager`
              : "Bare aktive"}
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="text-[12.5px] font-medium text-ink-faint hover:text-ink"
            >
              Nullstill filter
            </button>
          )}
        </div>
      )}

      {(search ||
        ownerId !== "alle" ||
        businessUnitId !== "alle" ||
        tagId !== "alle" ||
        datePreset !== "alle" ||
        activeDays != null) && (
        <p className="mb-3 text-[12.5px] text-ink-faint">
          Viser {filtered.length} av {rows.length} deals
        </p>
      )}

      {datePreset === "idag" && filtered.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-mist/[0.03] px-4 py-3">
          <span className="text-[12.5px] text-ink-soft">
            Ingen treff de siste 7 dagene. Prøv i stedet:
          </span>
          <button
            onClick={() => setDatePreset("forfalt")}
            className="rounded-full bg-mist/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition hover:bg-mist/[0.1] hover:text-ink"
          >
            Forfalt
          </button>
          <button
            onClick={() => setDatePreset("neste7")}
            className="rounded-full bg-mist/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition hover:bg-mist/[0.1] hover:text-ink"
          >
            Deadline neste 7 dager
          </button>
        </div>
      )}

      {view === "kanban" ? (
        <KanbanBoard deals={kanbanItems} stages={stages} lostReasons={lostReasons} />
      ) : (
        <DealsTable
          rows={filtered}
          stages={stages}
          owners={owners}
          lostReasons={lostReasons}
          tags={tags}
          groupByStage={groupByStage}
        />
      )}
    </div>
  );
}
