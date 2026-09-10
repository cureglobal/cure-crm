import { cache } from "react";
import { asc, eq, getTableColumns } from "drizzle-orm";
import { db, deals, companies, type Deal } from "@/lib/db";
import { slugify } from "@/lib/slugify";

export function computeDealSlug(companyName: string, dealTitle: string): string {
  const base = `${slugify(companyName)}-${slugify(dealTitle)}`
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "deal";
}

// Full deal-rad + selskapsnavn for hver deal i databasen — grunnlaget for
// både slug-kartet under og resolveDealSlugToDeal(). Hentes bare én gang per
// request (React cache()) uansett hvor mange av de to som trenger dataene,
// slik at f.eks. deal-siden kan slå opp slug-en OG hente hele deal-raden i
// samme nettverkstur i stedet for to.
const getDealSlugRows = cache(async () => {
  return db
    .select({ ...getTableColumns(deals), companyName: companies.name })
    .from(deals)
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .orderBy(asc(deals.id));
});

// Kart fra deal-id til den endelige (unike) slug-en, for hele databasen.
// Kolliderende slugs (samme selskap+dealnavn-kombinasjon) får -2, -3, … lagt
// til i rekkefølgen deal-ene ble opprettet i. React cache() deduper kallet
// innenfor samme request.
export const getDealSlugMap = cache(async (): Promise<Map<number, string>> => {
  const rows = await getDealSlugRows();
  const map = new Map<number, string>();
  const seenCount = new Map<string, number>();
  for (const row of rows) {
    const base = computeDealSlug(row.companyName, row.title);
    const count = (seenCount.get(base) ?? 0) + 1;
    seenCount.set(base, count);
    map.set(row.id, count === 1 ? base : `${base}-${count}`);
  }
  return map;
});

// Tar imot en URL-segment (fra /leads/[slug]) og finner deal-id-en den peker
// på. Rene tall støttes fortsatt (gamle lenker til /leads/25), ellers slås
// den opp mot det beregnede slug-kartet.
export async function resolveDealSlugToId(param: string): Promise<number | null> {
  if (/^\d+$/.test(param)) return Number(param);
  const map = await getDealSlugMap();
  for (const [id, slug] of map) {
    if (slug === param) return id;
  }
  return null;
}

// Som resolveDealSlugToId, men returnerer hele deal-raden med én gang i
// stedet for bare id-en — sparer et separat db.query.deals.findFirst()-kall
// (og dermed en hel ekstra nettverkstur mot Turso) etterpå på deal-siden,
// som ellers måtte vente på denne oppslaget først uansett.
export async function resolveDealSlugToDeal(param: string): Promise<Deal | null> {
  if (/^\d+$/.test(param)) {
    return (await db.query.deals.findFirst({ where: eq(deals.id, Number(param)) })) ?? null;
  }
  const rows = await getDealSlugRows();
  const seenCount = new Map<string, number>();
  for (const row of rows) {
    const base = computeDealSlug(row.companyName, row.title);
    const count = (seenCount.get(base) ?? 0) + 1;
    seenCount.set(base, count);
    const slug = count === 1 ? base : `${base}-${count}`;
    if (slug === param) return row;
  }
  return null;
}
