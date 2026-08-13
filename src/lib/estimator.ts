// Faste faser i et prosjektestimat. Nøkkelen brukes til å koble
// referanseprosjekter til riktig fase for sammenligning senere.
export type PhaseKey =
  | "oppstart"
  | "struktur"
  | "design"
  | "utvikling"
  | "seo"
  | "integrasjoner"
  | "testing"
  | "prosjektledelse";

export interface PhaseDef {
  key: PhaseKey;
  label: string;
}

export const PHASES: PhaseDef[] = [
  { key: "oppstart", label: "Oppstartsworkshop" },
  { key: "struktur", label: "Struktur og IA" },
  { key: "design", label: "Statisk design" },
  { key: "utvikling", label: "Utvikling" },
  { key: "seo", label: "SEO/AEO" },
  { key: "integrasjoner", label: "Integrasjoner" },
  { key: "testing", label: "Testing og lansering" },
  { key: "prosjektledelse", label: "Prosjektledelse" },
];

export function phaseLabel(key: string): string {
  return PHASES.find((p) => p.key === key)?.label ?? key;
}

export type ComplexityTier = "enkel" | "middels" | "avansert";

export interface ScanSignals {
  pageCount: number;
  pageCountSource: "sitemap" | "forside" | "ukjent";
  complexityTier: ComplexityTier;
  ecommerce: boolean;
  multiLanguage: boolean;
  languageCount: number;
  hasForm: boolean;
  hasBlog: boolean;
  cms: string | null;
  isSpaFramework: boolean;
}

// Rene timeanslag ut fra sideantall og oppdagede signaler. Dette er en
// heuristikk, ikke en fasit — tallene er ment som et startpunkt man justerer,
// ikke et presist estimat. Prosjektledelse beregnes for seg (10 % av resten).
export function estimateHours(signals: ScanSignals): Record<PhaseKey, number> {
  const pages = Math.max(1, signals.pageCount);
  // Kvadratrot, ikke lineært: et sitemap med 300 blogginnlegg er ikke 300×
  // designarbeidet av én mal — det er avtagende innsats per side ettersom
  // antallet vokser, siden mange sider deler samme mal/struktur.
  const pageFactor = Math.sqrt(pages);
  const complexityMult =
    signals.complexityTier === "avansert" ? 1.5 : signals.complexityTier === "middels" ? 1.15 : 1;

  const oppstart = 12;

  const struktur = round(4 + pageFactor * 3 * complexityMult, 60);

  const design = round(8 + pageFactor * 6 * complexityMult, 140);

  let utvikling = 16 + pageFactor * 10 * complexityMult;
  if (signals.ecommerce) utvikling += 30;
  if (signals.isSpaFramework) utvikling += 15;
  utvikling = round(utvikling, 300);

  let seo = 6 + pageFactor * 2.2;
  if (signals.multiLanguage) seo += 8 * Math.max(0, signals.languageCount - 1);
  seo = round(seo, 60);

  const testing = round(utvikling * 0.25 + 4, 100);

  const integrasjoner = 0; // står tom — fylles inn manuelt ved behov

  const sumUtenPl = oppstart + struktur + design + utvikling + seo + integrasjoner + testing;
  const prosjektledelse = Math.round(sumUtenPl * 0.1);

  return {
    oppstart,
    struktur,
    design,
    utvikling,
    seo,
    integrasjoner,
    testing,
    prosjektledelse,
  };
}

// Runder til nærmeste halvtime og setter et romslig tak så ekstreme
// enkeltsignaler (f.eks. en gigantisk sitemap) ikke gir absurde anslag —
// taket skal bare stoppe uteliggere, ikke flate ut normale, store nettsteder.
function round(hours: number, cap: number): number {
  const capped = Math.min(hours, cap);
  return Math.round(capped * 2) / 2;
}

// Beregner prosjektledelse på nytt ut fra de andre fasenes SUM (brukes når
// brukeren justerer timer manuelt i verktøyet — prosjektledelse skal alltid
// følge 10 %-regelen).
export function recalcProjectManagement(otherPhaseHours: number[]): number {
  return Math.round(otherPhaseHours.reduce((a, b) => a + b, 0) * 0.1);
}

export const DEFAULT_HOURLY_RATE = 1550;
