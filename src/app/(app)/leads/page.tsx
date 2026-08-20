import { parseFiltersFromParams } from "@/lib/pipelineFilters";
import PipelinePageContent from "@/components/PipelinePageContent";

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const params = await searchParams;
  const filters = parseFiltersFromParams(params);
  return <PipelinePageContent filters={filters} />;
}
