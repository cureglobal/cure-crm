// Rene, klient-trygge hjelpefunksjoner for faser — INGEN import av
// "@/lib/db" her. Den modulen oppretter libSQL-klienten i toppnivå-scope
// (createClient med en "file:"-URL lokalt), og siden flere klientkomponenter
// (DealsTable, ImportDialog m.fl.) importerer ekte funksjoner herfra (ikke
// bare typer), ville en slik import blitt bundlet inn i nettleseren og
// krasjet momentant ("URL_SCHEME_NOT_SUPPORTED"). Den faktiske databasespørringen
// (getStages) ligger derfor i en egen fil, stages.server.ts, som kun
// Server Components importerer.
import type { Stage } from "@/lib/db/schema";

export type { Stage };

export function stageLabel(stages: Stage[], id: string) {
  return stages.find((s) => String(s.id) === id)?.label ?? id;
}

export function stageDot(stages: Stage[], id: string) {
  return stages.find((s) => String(s.id) === id)?.color ?? "#8e8e93";
}

export function firstStageId(stages: Stage[]): string {
  return stages.length > 0 ? String(stages[0].id) : "";
}
