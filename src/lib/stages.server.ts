import { cache } from "react";
import { asc } from "drizzle-orm";
import { db, stages as stagesTable } from "@/lib/db";
import type { Stage } from "@/lib/db/schema";
import { firstStageId } from "@/lib/stages";

// Server-only: henter fasene fra databasen. Uten pipelineId hentes ALLE
// faser på tvers av pipelines (brukt der man bevisst vil se/klassifisere på
// tvers, f.eks. dashboard, selskaps- og personsider) — med pipelineId
// filtreres til bare den ene pipelinens faser (Pipeline-siden, Statistikk,
// Innstillinger sin fase-editor). React cache() deduper kallet innenfor
// samme request, per argument. Må ALDRI importeres fra en "use client"-fil
// — se kommentaren i stages.ts for hvorfor.
export const getStages = cache(async (pipelineId?: number): Promise<Stage[]> => {
  const rows = await db.query.stages.findMany({ orderBy: [asc(stagesTable.sortOrder)] });
  return pipelineId == null ? rows : rows.filter((s) => s.pipelineId === pipelineId);
});

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
