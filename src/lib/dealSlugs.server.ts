import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db, deals, companies } from "@/lib/db";

// Norske bokstaver har ingen NFKD-dekomponering (æ/ø har ingen kombinerende
// diakritisk å fjerne), så de må translittereres eksplisitt før resten av
// tegnene normaliseres bort.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function computeDealSlug(companyName: string, dealTitle: string): string {
  const base = `${slugify(companyName)}-${slugify(dealTitle)}`
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "deal";
}

// Kart fra deal-id til den endelige (unike) slug-en, for hele databasen.
// Kolliderende slugs (samme selskap+dealnavn-kombinasjon) får -2, -3, … lagt
// til i rekkefølgen deal-ene ble opprettet i. React cache() deduper kallet
// innenfor samme request.
export const getDealSlugMap = cache(async (): Promise<Map<number, string>> => {
  const rows = await db
    .select({ id: deals.id, title: deals.title, companyName: companies.name })
    .from(deals)
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .orderBy(asc(deals.id));

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
