import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db, tags as tagsTable } from "@/lib/db";
import type { Tag } from "@/lib/db/schema";

export const getTags = cache(async (entityType: "deal" | "person"): Promise<Tag[]> => {
  return db.query.tags.findMany({
    where: eq(tagsTable.entityType, entityType),
    orderBy: [asc(tagsTable.sortOrder)],
  });
});
