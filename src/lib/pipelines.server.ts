import { cache } from "react";
import { asc } from "drizzle-orm";
import { db, pipelines as pipelinesTable } from "@/lib/db";
import type { Pipeline } from "@/lib/db/schema";

export const getPipelines = cache(async (): Promise<Pipeline[]> => {
  return db.query.pipelines.findMany({ orderBy: [asc(pipelinesTable.sortOrder)] });
});

// Skal alltid finnes minst én (seedet i migrate.ts) — fallback-id-en brukes
// bare defensivt hvis noe uventet skulle mangle helt.
export async function getDefaultPipelineId(): Promise<number> {
  const rows = await getPipelines();
  return rows[0]?.id ?? 1;
}
