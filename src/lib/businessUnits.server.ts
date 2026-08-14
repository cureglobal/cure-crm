import { cache } from "react";
import { asc } from "drizzle-orm";
import { db, businessUnits as businessUnitsTable } from "@/lib/db";
import type { BusinessUnit } from "@/lib/db/schema";

// Server-only, samme mønster som stages.server.ts. Ingen egen klient-trygg
// fil trengs her — ingen klientkomponent trenger annet enn rå {id, name}-data
// som props, aldri ekte funksjoner fra denne modulen.
export const getBusinessUnits = cache(async (): Promise<BusinessUnit[]> => {
  return db.query.businessUnits.findMany({ orderBy: [asc(businessUnitsTable.sortOrder)] });
});
