import { cache } from "react";
import { asc } from "drizzle-orm";
import { db, lostReasons as lostReasonsTable } from "@/lib/db";
import type { LostReason } from "@/lib/db/schema";

export const getLostReasons = cache(async (): Promise<LostReason[]> => {
  return db.query.lostReasons.findMany({ orderBy: [asc(lostReasonsTable.sortOrder)] });
});
