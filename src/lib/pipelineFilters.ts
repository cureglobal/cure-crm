import type { SavedViewFilters } from "@/lib/actions";

export type DatePreset = "alle" | "forfalt" | "idag" | "uke" | "neste7" | "egendefinert";

// Udefinert felt = "ikke satt" (PipelineView avgjør da selv ut fra lagrede
// preferanser/faste standardverdier, se PipelineView.tsx).
export interface ResolvedFilters {
  view?: "kanban" | "liste";
  search?: string;
  pipelineId?: number;
  ownerId?: "alle" | number;
  businessUnitId?: "alle" | number;
  datePreset?: DatePreset;
  fromDate?: string;
  toDate?: string;
  // Antall dager siden siste oppdatering — "Bare aktive" bruker en fast
  // standardverdi, men lagrede visninger kan sette et annet tall (f.eks. 7
  // for "Aktiv siste uken").
  activeDays?: number;
  groupByStage?: boolean;
}

type RawParams = Record<string, string | string[] | undefined>;

function str(params: RawParams, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" ? v : undefined;
}

// Tolker URL-spørrestrengen på /leads (og eventuelle overstyringer på
// /leads/visning/[slug]) til filterverdier. Bare felt som faktisk er gyldig
// satt i params fylles inn — resten forblir undefined.
export function parseFiltersFromParams(params: RawParams): ResolvedFilters {
  const view = str(params, "view");
  const dato = str(params, "dato");
  const eier = str(params, "eier");
  const enhet = str(params, "enhet");
  const aktive = str(params, "aktive");
  const gruppe = str(params, "gruppe");
  const pipeline = str(params, "pipeline");
  return {
    view: view === "liste" || view === "kanban" ? view : undefined,
    search: str(params, "s"),
    pipelineId: pipeline != null && /^\d+$/.test(pipeline) ? Number(pipeline) : undefined,
    ownerId:
      eier === "alle" ? "alle" : eier != null && /^\d+$/.test(eier) ? Number(eier) : undefined,
    businessUnitId:
      enhet === "alle" ? "alle" : enhet != null && /^\d+$/.test(enhet) ? Number(enhet) : undefined,
    datePreset:
      dato === "uke" ||
      dato === "forfalt" ||
      dato === "idag" ||
      dato === "neste7" ||
      dato === "egendefinert"
        ? dato
        : undefined,
    fromDate: str(params, "fra"),
    toDate: str(params, "til"),
    // 0 = eksplisitt av (skiller seg fra undefined = ikke satt i det hele
    // tatt), samme mønster som datePreset/gruppe hadde med boolean før.
    activeDays: aktive != null && /^\d+$/.test(aktive) ? Number(aktive) : undefined,
    groupByStage: gruppe === "fase" ? true : gruppe === "flat" ? false : undefined,
  };
}

// URL-parametre på /leads/visning/[slug] overstyrer enkeltfelt fra den
// lagrede visningen — man kan starte fra en lagret visning og justere ett
// filter uten å måtte lagre en ny (samme forrangs-mønster som URL >
// localStorage i PipelineView).
export function mergeFilters(base: ResolvedFilters, override: ResolvedFilters): ResolvedFilters {
  return {
    view: override.view ?? base.view,
    search: override.search ?? base.search,
    pipelineId: override.pipelineId ?? base.pipelineId,
    ownerId: override.ownerId ?? base.ownerId,
    businessUnitId: override.businessUnitId ?? base.businessUnitId,
    datePreset: override.datePreset ?? base.datePreset,
    fromDate: override.fromDate ?? base.fromDate,
    toDate: override.toDate ?? base.toDate,
    activeDays: override.activeDays ?? base.activeDays,
    groupByStage: override.groupByStage ?? base.groupByStage,
  };
}

// -1 er brukt som sentinel for "alle" i saved_views sine eier/enhet-
// kolonner (rene heltallskolonner kan ikke skille NULL="ikke satt" fra en
// eksplisitt "alle" uten dette) — se createSavedView i actions.ts.
export function savedViewToFilters(v: SavedViewFilters): ResolvedFilters {
  return {
    view: v.view === "liste" || v.view === "kanban" ? v.view : undefined,
    search: v.search ?? undefined,
    pipelineId: v.pipelineId ?? undefined,
    ownerId: v.ownerId === -1 ? "alle" : (v.ownerId ?? undefined),
    businessUnitId: v.businessUnitId === -1 ? "alle" : (v.businessUnitId ?? undefined),
    datePreset:
      v.datePreset === "uke" ||
      v.datePreset === "forfalt" ||
      v.datePreset === "idag" ||
      v.datePreset === "neste7" ||
      v.datePreset === "egendefinert"
        ? v.datePreset
        : undefined,
    fromDate: v.fromDate ?? undefined,
    toDate: v.toDate ?? undefined,
    activeDays: v.activeDays ?? undefined,
    groupByStage: v.groupByStage ?? undefined,
  };
}
