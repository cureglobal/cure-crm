import { asc } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import { effectiveProbability } from "@/lib/dealProbability";
import type { Deal, Stage } from "@/lib/db/schema";
import type { StatDealRow } from "@/components/StatDealsList";

export interface DealListContext {
  companyById: Map<number, { name: string; logoUrl: string | null }>;
  ownerById: Map<number, { name: string; avatarDataUrl: string | null }>;
  slugMap: Map<number, string>;
}

// Felles oppslagsdata for detaljlistene Statistikk-tallene lenker til
// (sum/estimert/lead time) — hentes én gang per side.
export async function getDealListContext(): Promise<DealListContext> {
  const [allCompanies, allUsers, slugMap] = await Promise.all([
    db.query.companies.findMany(),
    db.query.users.findMany({ orderBy: [asc(users.name)] }),
    getDealSlugMap(),
  ]);
  return {
    companyById: new Map(allCompanies.map((c) => [c.id, { name: c.name, logoUrl: c.logoUrl }])),
    ownerById: new Map(allUsers.map((u) => [u.id, { name: u.name, avatarDataUrl: u.avatarDataUrl }])),
    slugMap,
  };
}

// `closedAtMs` sendes inn separat (i stedet for å lese deal.closedAt selv)
// siden vunnet-listen skal vise samme dato som lead time-tallet ble regnet
// ut fra (closedAt med updatedAt som fallback).
export function toStatDealRow(
  deal: Deal,
  ctx: DealListContext,
  stageById: Map<string, Pick<Stage, "probability">>,
  closedAtMs: number | null = null
): StatDealRow {
  const company = ctx.companyById.get(deal.companyId);
  const owner = deal.ownerId != null ? ctx.ownerById.get(deal.ownerId) : undefined;
  return {
    id: deal.id,
    slug: ctx.slugMap.get(deal.id) ?? String(deal.id),
    companyName: company?.name ?? "Ukjent selskap",
    logoUrl: company?.logoUrl ?? null,
    dealTitle: deal.title,
    ownerName: owner?.name ?? "",
    ownerAvatarUrl: owner?.avatarDataUrl ?? null,
    value: deal.value,
    probability: effectiveProbability(deal, stageById),
    closedAt: closedAtMs,
  };
}
