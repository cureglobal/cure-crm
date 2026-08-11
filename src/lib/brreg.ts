// Klient mot Brønnøysundregistrenes åpne API (data.brreg.no).
// Ingen nøkkel kreves. Merk: telefonnummer finnes ikke i API-et — det må fylles
// inn manuelt i CRM-et.

const ENHET_BASE = "https://data.brreg.no/enhetsregisteret/api/enheter";
const REGNSKAP_BASE = "https://data.brreg.no/regnskapsregisteret/regnskap";

export interface BrregCompany {
  orgNumber: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  employees: number | null;
  industry: string | null;
  industryCode: string | null;
  ceoName: string | null;
  revenue: number | null;
  profit: number | null;
  fiscalYear: string | null;
  bankrupt: boolean;
  liquidating: boolean;
  orgForm: string | null;
}

export interface BrregHit {
  orgNumber: string;
  name: string;
  city: string | null;
  orgForm: string | null;
  industry: string | null;
  employees: number | null;
}

export function normalizeOrgNumber(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface EnhetResponse {
  organisasjonsnummer?: string;
  navn?: string;
  antallAnsatte?: number;
  konkurs?: boolean;
  underAvvikling?: boolean;
  organisasjonsform?: { beskrivelse?: string };
  naeringskode1?: { kode?: string; beskrivelse?: string };
  forretningsadresse?: { adresse?: string[]; postnummer?: string; poststed?: string };
  postadresse?: { adresse?: string[]; postnummer?: string; poststed?: string };
}

function titleCase(value: string): string {
  // brreg returnerer navn i VERSALER; gjør det lesbart uten å ødelegge AS/ASA.
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => {
      if (/^\s+$|^-$/.test(part)) return part;
      if (["as", "asa", "ba", "sa", "ans", "da", "nuf", "iks", "kf"].includes(part)) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

export async function searchBrreg(query: string): Promise<BrregHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const orgNumber = normalizeOrgNumber(trimmed);
  const url = orgNumber
    ? `${ENHET_BASE}?organisasjonsnummer=${orgNumber}`
    : `${ENHET_BASE}?navn=${encodeURIComponent(trimmed)}&size=8`;

  const data = (await getJson(url)) as
    | { _embedded?: { enheter?: EnhetResponse[] } }
    | null;
  const hits = data?._embedded?.enheter ?? [];

  return hits
    .filter((e) => e.organisasjonsnummer && e.navn)
    .map((e) => ({
      orgNumber: e.organisasjonsnummer!,
      name: titleCase(e.navn!),
      city: e.forretningsadresse?.poststed
        ? titleCase(e.forretningsadresse.poststed)
        : null,
      orgForm: e.organisasjonsform?.beskrivelse ?? null,
      industry: e.naeringskode1?.beskrivelse ?? null,
      employees: typeof e.antallAnsatte === "number" ? e.antallAnsatte : null,
    }));
}

// ---------- Automatisk matching ----------

const LEGAL_SUFFIXES = new Set([
  "as", "asa", "ans", "da", "sa", "ba", "nuf", "iks", "kf", "ks", "enk", "fkf", "sf",
]);

// Organisasjonsformer som sjelden er kunden vi leter etter.
const UNLIKELY_FORMS = [
  "borettslag", "utenlandsk", "forening", "sameie", "stiftelse", "tingsrettslig",
  "enkeltpersonforetak", "kommune", "fylke", "konkursbo",
];

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " og ")
    .replace(/[.,''`"()\-/]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_SUFFIXES.has(w))
    .join(" ")
    .trim();
}

function domainBase(domain: string | null): string | null {
  if (!domain) return null;
  const base = domain.replace(/^www\./, "").split(".")[0];
  return base ? base.toLowerCase() : null;
}

export interface MatchCandidate extends BrregHit {
  score: number;
}

export interface MatchResult {
  best: MatchCandidate | null;
  candidates: MatchCandidate[];
  confident: boolean;
  reason: string;
}

function scoreHit(hit: BrregHit, queryNorm: string, domainNorm: string | null): number {
  const hitNorm = normalizeName(hit.name);
  let score = 0;

  if (hitNorm === queryNorm) {
    score = 1;
  } else if (hitNorm.startsWith(`${queryNorm} `)) {
    // «Ado Arena» mot «AdO Arena Drift AS» — offisielt navn utvider kallenavnet.
    score = 0.88;
  } else if (hitNorm.includes(queryNorm)) {
    score = 0.72;
  } else {
    const queryWords = queryNorm.split(" ").filter(Boolean);
    const hitWords = new Set(hitNorm.split(" ").filter(Boolean));
    const overlap = queryWords.filter((w) => hitWords.has(w)).length;
    score = queryWords.length > 0 ? (overlap / queryWords.length) * 0.6 : 0;
  }

  // Domenet er et sterkt signal: favna.no ⇒ «Favna AS». Bare full likhet regnes
  // som eksakt — en delvis domenetreff løftes, men holdes under eksaktgrensen,
  // ellers ville «united.no» slått fast «United United Media DA».
  if (domainNorm) {
    const hitCompact = hitNorm.replace(/\s/g, "");
    if (hitCompact === domainNorm) score = Math.max(score, 0.97);
    else if (hitCompact.startsWith(domainNorm)) score = Math.min(0.94, score + 0.12);
  }

  const form = (hit.orgForm ?? "").toLowerCase();
  if (UNLIKELY_FORMS.some((f) => form.includes(f))) score -= 0.25;
  // Drift i selskapet taler for at det er dette vi handler med, ikke holding.
  if ((hit.employees ?? 0) > 0) score += 0.03;

  return Math.max(0, Math.min(1, score));
}

// Finner det mest sannsynlige selskapet i Enhetsregisteret ut fra navn og domene.
// `confident` er bare sann når treffet er tydelig bedre enn nummer to.
export async function matchBrregCompany(
  name: string,
  domain: string | null = null
): Promise<MatchResult> {
  const queryNorm = normalizeName(name);
  const domainNorm = domainBase(domain);
  if (!queryNorm && !domainNorm) {
    return { best: null, candidates: [], confident: false, reason: "Mangler navn" };
  }

  // Søk både på kallenavnet og på domenet — de treffer ofte ulikt.
  const queries = [name.trim()];
  if (domainNorm && domainNorm !== queryNorm.replace(/\s/g, "")) queries.push(domainNorm);

  const seen = new Map<string, BrregHit>();
  for (const q of queries) {
    for (const hit of await searchBrreg(q)) {
      if (!seen.has(hit.orgNumber)) seen.set(hit.orgNumber, hit);
    }
  }

  const candidates = [...seen.values()]
    .map((hit) => ({ ...hit, score: scoreHit(hit, queryNorm, domainNorm) }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { best: null, candidates: [], confident: false, reason: "Ingen treff" };
  }

  const best = candidates[0];
  const second = candidates[1];
  const margin = second ? best.score - second.score : 1;

  const bestNorm = normalizeName(best.name);
  const isExactName = bestNorm === queryNorm;
  const isExactDomain = domainNorm !== null && bestNorm.replace(/\s/g, "") === domainNorm;

  // Et eksakt navnetreff er sterkere enn margin til nummer to: «Framo AS» skal
  // vinne over «Framo Flatøy AS» selv om sistnevnte også skårer høyt.
  const exactWinner = best.score >= 0.97 && (!second || second.score < 0.97);

  // Kallenavnet må dekke minst halve det offisielle navnet. «Ado Arena» dekker
  // «Ado Arena Drift» godt nok, mens «united» mot «United United Media DA» er
  // for tynt til å stole på.
  const queryWordCount = queryNorm.split(" ").filter(Boolean).length;
  const bestWordCount = bestNorm.split(" ").filter(Boolean).length;
  const coverage = bestWordCount > 0 ? queryWordCount / bestWordCount : 0;
  const enoughCoverage = isExactName || isExactDomain || coverage >= 0.5;

  let confident = false;
  let reason: string;
  if (best.score < 0.8) {
    reason = `Svakt treff (${Math.round(best.score * 100)} %)`;
  } else if (!enoughCoverage) {
    reason = `Usikkert — «${name}» dekker bare deler av «${best.name}»`;
  } else if (!exactWinner && margin < 0.12) {
    reason = `Flere like treff — ${best.name} og ${second!.name}`;
  } else {
    confident = true;
    reason = `Sikker match (${Math.round(best.score * 100)} %)`;
  }

  return { best, candidates: candidates.slice(0, 8), confident, reason };
}

interface RollerResponse {
  rollegrupper?: {
    type?: { kode?: string };
    roller?: {
      type?: { kode?: string };
      avregistrert?: boolean;
      person?: { navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string } };
    }[];
  }[];
}

async function fetchCeoName(orgNumber: string): Promise<string | null> {
  const data = (await getJson(`${ENHET_BASE}/${orgNumber}/roller`)) as RollerResponse | null;
  const group = data?.rollegrupper?.find((g) => g.type?.kode === "DAGL");
  const role = group?.roller?.find((r) => !r.avregistrert && r.person?.navn);
  const navn = role?.person?.navn;
  if (!navn) return null;
  return [navn.fornavn, navn.mellomnavn, navn.etternavn].filter(Boolean).join(" ");
}

interface RegnskapResponse {
  regnskapsperiode?: { tilDato?: string };
  resultatregnskapResultat?: {
    aarsresultat?: number;
    driftsresultat?: { driftsinntekter?: { sumDriftsinntekter?: number } };
  };
}

// Henter siste tilgjengelige årsregnskap: driftsinntekter og årsresultat.
async function fetchAccounts(orgNumber: string): Promise<{
  revenue: number | null;
  profit: number | null;
  fiscalYear: string | null;
}> {
  const data = (await getJson(`${REGNSKAP_BASE}/${orgNumber}`)) as
    | RegnskapResponse[]
    | null;
  if (!Array.isArray(data) || data.length === 0) {
    return { revenue: null, profit: null, fiscalYear: null };
  }

  const latest = [...data].sort((a, b) =>
    (b.regnskapsperiode?.tilDato ?? "").localeCompare(a.regnskapsperiode?.tilDato ?? "")
  )[0];

  const result = latest.resultatregnskapResultat;
  const revenue = result?.driftsresultat?.driftsinntekter?.sumDriftsinntekter;
  return {
    revenue: typeof revenue === "number" ? Math.round(revenue) : null,
    profit:
      typeof result?.aarsresultat === "number" ? Math.round(result.aarsresultat) : null,
    fiscalYear: latest.regnskapsperiode?.tilDato?.slice(0, 4) ?? null,
  };
}

export async function fetchBrregCompany(
  orgNumberInput: string
): Promise<BrregCompany | null> {
  const orgNumber = normalizeOrgNumber(orgNumberInput);
  if (!orgNumber) return null;

  const enhet = (await getJson(`${ENHET_BASE}/${orgNumber}`)) as EnhetResponse | null;
  if (!enhet?.organisasjonsnummer || !enhet.navn) return null;

  const [ceoName, accounts] = await Promise.all([
    fetchCeoName(orgNumber),
    fetchAccounts(orgNumber),
  ]);

  const addr = enhet.forretningsadresse ?? enhet.postadresse;

  return {
    orgNumber,
    name: titleCase(enhet.navn),
    address: addr?.adresse?.filter(Boolean).join(", ") || null,
    postalCode: addr?.postnummer ?? null,
    city: addr?.poststed ? titleCase(addr.poststed) : null,
    employees: typeof enhet.antallAnsatte === "number" ? enhet.antallAnsatte : null,
    industry: enhet.naeringskode1?.beskrivelse ?? null,
    industryCode: enhet.naeringskode1?.kode ?? null,
    ceoName,
    revenue: accounts.revenue,
    profit: accounts.profit,
    fiscalYear: accounts.fiscalYear,
    bankrupt: Boolean(enhet.konkurs),
    liquidating: Boolean(enhet.underAvvikling),
    orgForm: enhet.organisasjonsform?.beskrivelse ?? null,
  };
}
