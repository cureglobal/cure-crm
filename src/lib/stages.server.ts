import { cache } from "react";
import { asc } from "drizzle-orm";
import { db, stages as stagesTable } from "@/lib/db";
import type { Stage } from "@/lib/db/schema";
import { firstStageId } from "@/lib/stages";

// Server-only: henter fasene fra databasen. React cache() deduper kallet
// innenfor samme request. Må ALDRI importeres fra en "use client"-fil — se
// kommentaren i stages.ts for hvorfor.
export const getStages = cache(async (): Promise<Stage[]> => {
  return db.query.stages.findMany({ orderBy: [asc(stagesTable.sortOrder)] });
});

// Fasen nye deals settes til ved opprettelse — "Mulighet" spesifikt, uansett
// hvor i sorteringen den fasen faktisk ligger. Faller tilbake til den første
// fasen (etter sortOrder) hvis "Mulighet" er omdøpt eller slettet.
export async function getDefaultStageId(): Promise<string> {
  const stages = await getStages();
  const mulighet = stages.find((s) => s.label.trim().toLowerCase() === "mulighet");
  return mulighet ? String(mulighet.id) : firstStageId(stages);
}
