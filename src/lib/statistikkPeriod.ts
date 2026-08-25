import { parseDateStr } from "@/components/CalendarPopover";

export type Periode = "30" | "kvartal" | "ar" | "egendefinert";

export function parsePeriodeParam(v: unknown): Periode {
  return v === "kvartal" || v === "ar" || v === "egendefinert" ? v : "30";
}

export function periodRange(periode: Periode, fra: string, til: string): { start: Date; end: Date } {
  const now = new Date();
  if (periode === "egendefinert") {
    const start = parseDateStr(fra) ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const endDay = parseDateStr(til) ?? now;
    const end = new Date(
      endDay.getFullYear(),
      endDay.getMonth(),
      endDay.getDate(),
      23,
      59,
      59,
      999
    );
    return { start, end };
  }
  if (periode === "kvartal") {
    return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), end: now };
  }
  if (periode === "ar") return { start: new Date(now.getFullYear(), 0, 1), end: now };
  return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
}

// Bygger query-strengen som brukes til å lenke fra Statistikk-tallene til
// detaljlistene under, slik at listen viser nøyaktig samme periode/pipeline
// som tallet ble regnet ut fra.
export function statistikkQuery(params: {
  periode: Periode;
  fra: string;
  til: string;
  pipelineId: number;
}): string {
  const qs = new URLSearchParams();
  qs.set("periode", params.periode);
  if (params.periode === "egendefinert") {
    if (params.fra) qs.set("fra", params.fra);
    if (params.til) qs.set("til", params.til);
  }
  qs.set("pipeline", String(params.pipelineId));
  return qs.toString();
}
