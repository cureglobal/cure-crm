import { cache } from "react";
import { asc } from "drizzle-orm";
import { db, stages as stagesTable } from "@/lib/db";
import type { Stage } from "@/lib/db/schema";

// Server-only: henter fasene fra databasen. React cache() deduper kallet
// innenfor samme request. Må ALDRI importeres fra en "use client"-fil — se
// kommentaren i stages.ts for hvorfor.
export const getStages = cache(async (): Promise<Stage[]> => {
  return db.query.stages.findMany({ orderBy: [asc(stagesTable.sortOrder)] });
});
