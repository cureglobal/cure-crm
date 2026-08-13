import Anthropic from "@anthropic-ai/sdk";
import { matchBrregCompany, fetchBrregCompany, type BrregHit, type BrregCompany } from "@/lib/brreg";

export interface SizeTier {
  label: string;
  budgetHint: string;
}

// Terskler og budsjettforslag er bevisst grove tommelfingerregler (brukerens
// egen kalibrering: "en milliardbedrift er mer åpen for 500k+ enn en
// nyoppstartet med under 10M omsetning") — ikke en fasit.
function sizeTierFromRevenue(revenue: number | null): SizeTier {
  if (revenue == null) {
    return {
      label: "Ukjent størrelse",
      budgetHint: "Ingen omsetningstall funnet i Brreg — vurder ut fra bransje og ansatte.",
    };
  }
  if (revenue < 10_000_000) {
    return { label: "Oppstart / liten bedrift", budgetHint: "Realistisk budsjett ofte 50 000–150 000 kr." };
  }
  if (revenue < 100_000_000) {
    return { label: "SMB", budgetHint: "Realistisk budsjett ofte 150 000–400 000 kr." };
  }
  if (revenue < 1_000_000_000) {
    return { label: "Mellomstor/stor bedrift", budgetHint: "Realistisk budsjett ofte 300 000–800 000 kr." };
  }
  return {
    label: "Stor bedrift",
    budgetHint: "Åpne for 500 000 kr+ — vurder gjerne flere millioner ved større prosjekter.",
  };
}

export interface CompanyInsight {
  matched: BrregCompany;
  candidates: BrregHit[];
  confident: boolean;
  sizeTier: SizeTier;
  assessment: string;
}

async function generateAssessment(company: BrregCompany, ecommerceDetected: boolean): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Legg til ANTHROPIC_API_KEY i miljøvariablene for å få en automatisk vurdering av nettsidens viktighet og målgrupper.";
  }

  const prompt = `Du hjelper et digitalbyrå (Cure) vurdere et potensielt kundeprosjekt.

Selskap: ${company.name} (${company.orgForm ?? "ukjent selskapsform"})
Bransje: ${company.industry ?? "ukjent"}
Ansatte: ${company.employees ?? "ukjent"}
Omsetning (${company.fiscalYear ?? "siste år"}): ${company.revenue != null ? `${company.revenue} kr` : "ukjent"}
Resultat: ${company.profit != null ? `${company.profit} kr` : "ukjent"}
Nettbutikk oppdaget på siden: ${ecommerceDetected ? "ja" : "nei"}

Skriv en kort vurdering (maks 4–5 setninger, på norsk, ingen overskrift) av:
1. Hvor viktig en god nettside typisk er for bedrifter i denne bransjen.
2. Hvem som sannsynligvis er målgruppene for denne bedriftens nettside (B2B/B2C og hvilke kundetyper).
Vær konkret ut fra bransjen og størrelsen — ikke gjenta tallene fra konteksten, gå rett på vurderingen.`;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text"
      ? textBlock.text.trim()
      : "Kunne ikke generere en vurdering akkurat nå.";
  } catch {
    return "Kunne ikke generere en vurdering akkurat nå (API-feil).";
  }
}

async function finishInsight(
  orgNumber: string,
  candidates: BrregHit[],
  confident: boolean,
  ecommerceDetected: boolean
): Promise<{ ok: true; insight: CompanyInsight } | { ok: false; candidates: BrregHit[]; message: string }> {
  const company = await fetchBrregCompany(orgNumber);
  if (!company) {
    return { ok: false, candidates, message: "Fant ikke firmadetaljer i Brønnøysundregistrene." };
  }
  const sizeTier = sizeTierFromRevenue(company.revenue);
  const assessment = await generateAssessment(company, ecommerceDetected);
  return { ok: true, insight: { matched: company, candidates, confident, sizeTier, assessment } };
}

export async function lookupCompanyInsight(
  companyNameGuess: string,
  domain: string,
  ecommerceDetected: boolean
): Promise<{ ok: true; insight: CompanyInsight } | { ok: false; candidates: BrregHit[]; message: string }> {
  const match = await matchBrregCompany(companyNameGuess, domain);
  if (!match.best) {
    return { ok: false, candidates: [], message: "Fant ingen treff i Brønnøysundregistrene." };
  }
  if (!match.confident) {
    return { ok: false, candidates: match.candidates, message: match.reason };
  }
  return finishInsight(match.best.orgNumber, match.candidates, true, ecommerceDetected);
}

export async function lookupCompanyInsightByOrgNumber(
  orgNumber: string,
  candidates: BrregHit[],
  ecommerceDetected: boolean
): Promise<{ ok: true; insight: CompanyInsight } | { ok: false; candidates: BrregHit[]; message: string }> {
  return finishInsight(orgNumber, candidates, true, ecommerceDetected);
}
