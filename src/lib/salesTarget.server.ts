import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, salesTargets, monthlyActuals as monthlyActualsTable } from "@/lib/db";
import type { SalesTarget, MonthlyActual } from "@/lib/db/schema";

export const getSalesTarget = cache(async (year: number): Promise<SalesTarget | null> => {
  return (await db.query.salesTargets.findFirst({ where: eq(salesTargets.year, year) })) ?? null;
});

export const getMonthlyActuals = cache(async (year: number): Promise<MonthlyActual[]> => {
  return db.query.monthlyActuals.findMany({ where: eq(monthlyActualsTable.year, year) });
});
