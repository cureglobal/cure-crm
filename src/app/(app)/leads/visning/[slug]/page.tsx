import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, savedViews } from "@/lib/db";
import { parseFiltersFromParams, mergeFilters, savedViewToFilters } from "@/lib/pipelineFilters";
import PipelinePageContent from "@/components/PipelinePageContent";

// Lagret, navngitt filterkombinasjon for Pipeline-siden — se
// SavedViewsMenu.tsx (lagring) og PipelineView.tsx (URL-synk). URL-
// parametre her overstyrer enkeltfelt fra den lagrede visningen, slik at
// man kan starte fra en lagret visning og justere ett filter uten å måtte
// lagre en ny.
export default async function SavedViewPage({
  params,
  searchParams,
}: PageProps<"/leads/visning/[slug]">) {
  const { slug } = await params;
  const rawParams = await searchParams;

  const view = await db.query.savedViews.findFirst({ where: eq(savedViews.slug, slug) });
  if (!view) notFound();

  const filters = mergeFilters(savedViewToFilters(view), parseFiltersFromParams(rawParams));

  return <PipelinePageContent filters={filters} savedViewName={view.name} />;
}
