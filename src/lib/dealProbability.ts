import type { Deal, Stage } from "@/lib/db/schema";

// Deal-nivå overstyrer fasens standardsannsynlighet når satt — se
// deals.probabilityOverride. Delt mellom Statistikk-siden og
// detaljlistene den lenker til (sum/estimert/lead time).
export function effectiveProbability(
  deal: Pick<Deal, "probabilityOverride" | "stage">,
  stageById: Map<string, Pick<Stage, "probability">>
): number {
  if (deal.probabilityOverride != null) return deal.probabilityOverride;
  return stageById.get(deal.stage)?.probability ?? 50;
}
