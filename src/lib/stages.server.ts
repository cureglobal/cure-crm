import { cache } from "react";
import { asc } from "drizzle-orm";
import { db, stages as stagesTable } from "@/lib/db";
import type { Stage } from "@/lib/db/schema";
import { firstStageId } from "@/lib/stages";

// Henter ALLE faser på tvers av pipelines, én gang per request — React
// cache() deduper på tvers av alle kallere uansett om de ber om én bestemt
// pipeline eller ikke, se getStages() under. Egen funksjon UTEN argument
// slik at cache-nøkkelen alltid er den samme (cache() nøkler på argumentene,
// så getStages(1) og getStages(2) ville ellers vært to separate
// databasekall selv om de begge må hente hele tabellen uansett).
const getAllStages = cache(async (): Promise<Stage[]> => {
  return db.query.stages.findMany({ orderBy: [asc(stagesTable.sortOrder)] });
});

// Server-only: henter fasene. Uten pipelineId returneres ALLE faser på tvers
// av pipelines (brukt der man bevisst vil se/klassifisere på tvers, f.eks.
// dashboard, selskaps- og personsider) — med pipelineId filtreres til bare
// den ene pipelinens faser (Pipeline-siden, Statistikk, Innstillinger sin
// fase-editor). Filtreringen skjer i JS på et allerede request-cachet
// resultat, så dette koster aldri et ekstra databasekall. Må ALDRI
// importeres fra en "use client"-fil — se kommentaren i stages.ts for
// hvorfor.
export async function getStages(pipelineId?: number): Promise<Stage[]> {
  const rows = await getAllStages();
  return pipelineId == null ? rows : rows.filter((s) => s.pipelineId === pipelineId);
}

// Fasen nye deals settes til ved opprettelse, innenfor den valgte pipelinen
// — "Mulighet" spesifikt, uansett hvor i sorteringen den fasen faktisk
// ligger. Faller tilbake til den første fasen (etter sortOrder) i samme
// pipeline hvis "Mulighet" er omdøpt, slettet, eller ikke finnes i denne
// pipelinen (f.eks. en "Anbud"-pipeline med helt andre fasenavn).
export async function getDefaultStageId(pipelineId: number): Promise<string> {
  const stages = await getStages(pipelineId);
  const mulighet = stages.find((s) => s.label.trim().toLowerCase() === "mulighet");
  return mulighet ? String(mulighet.id) : firstStageId(stages);
}
