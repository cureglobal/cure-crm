import * as cheerio from "cheerio";
import { estimateHours, type PhaseKey, type ScanSignals } from "@/lib/estimator";
import { cleanTitle, fallbackNameFromDomain } from "@/lib/enrich";
import { isSafeExternalUrl } from "@/lib/urlSafety";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Sjekkes for HVER fetch her, ikke bare på URL-en brukeren opprinnelig
// oppga — en robots.txt/sitemap hentet fra en ellers gyldig nettside kan
// selv peke videre til en intern adresse (SSRF-kjeding).
async function fetchText(url: string, xml = false): Promise<string | null> {
  if (!(await isSafeExternalUrl(url))) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": UA,
        Accept: xml ? "application/xml,text/xml,*/*" : "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    return url.origin + (url.pathname !== "/" ? url.pathname : "");
  } catch {
    return null;
  }
}

// Teller <url>-elementer i en sitemap. Håndterer også sitemap-indekser (som
// selv lister opp flere undersitemaps) ved å summere de første fem.
async function countSitemapPages(origin: string): Promise<number | null> {
  let xml = await fetchText(`${origin}/sitemap.xml`, true);

  if (!xml) {
    const robots = await fetchText(`${origin}/robots.txt`);
    const match = robots?.match(/Sitemap:\s*(\S+)/i);
    if (match) xml = await fetchText(match[1], true);
  }
  if (!xml) return null;

  const $ = cheerio.load(xml, { xmlMode: true });

  const subSitemaps = $("sitemapindex > sitemap > loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .slice(0, 5);

  if (subSitemaps.length > 0) {
    let total = 0;
    for (const loc of subSitemaps) {
      const sub = await fetchText(loc, true);
      if (!sub) continue;
      total += cheerio.load(sub, { xmlMode: true })("urlset > url").length;
    }
    return total;
  }

  const count = $("urlset > url > loc").length;
  return count > 0 ? count : null;
}

function countHomepageLinks($: cheerio.CheerioAPI, origin: string): number {
  const host = new URL(origin).hostname;
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    try {
      const abs = new URL(href, origin);
      if (abs.hostname === host && abs.pathname !== "/" && !abs.pathname.match(/\.(pdf|jpg|png|zip)$/i)) {
        seen.add(abs.pathname);
      }
    } catch {
      // relativ/ugyldig lenke — ignorer
    }
  });
  return seen.size;
}

function detectSignals($: cheerio.CheerioAPI, html: string): Omit<ScanSignals, "pageCount" | "pageCountSource"> {
  const generator = ($('meta[name="generator"]').attr("content") ?? "").toLowerCase();
  const scripts = $("script[src]")
    .map((_, el) => $(el).attr("src") ?? "")
    .get()
    .join(" ")
    .toLowerCase();
  const bodyClasses = ($("body").attr("class") ?? "").toLowerCase();
  const lowerHtml = html.toLowerCase();

  let cms: string | null = null;
  if (generator.includes("wordpress") || lowerHtml.includes("wp-content")) cms = "WordPress";
  else if (generator.includes("shopify") || lowerHtml.includes("cdn.shopify.com")) cms = "Shopify";
  else if (generator.includes("wix.com")) cms = "Wix";
  else if (generator.includes("squarespace")) cms = "Squarespace";
  else if (generator.includes("webflow") || lowerHtml.includes("website-files.com")) cms = "Webflow";
  else if (bodyClasses.includes("woocommerce")) cms = "WooCommerce";

  const ecommerce =
    cms === "Shopify" ||
    cms === "WooCommerce" ||
    /add[-_]?to[-_]?cart|handlekurv|\/checkout|\/cart\b/i.test(lowerHtml);

  const isSpaFramework =
    scripts.includes("_next/") ||
    lowerHtml.includes("__next_data__") ||
    lowerHtml.includes("__nuxt__") ||
    $("[ng-version]").length > 0 ||
    lowerHtml.includes("id=\"root\"") && scripts.includes("react");

  const languages = new Set<string>();
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang");
    if (lang) languages.add(lang.toLowerCase());
  });
  const htmlLang = $("html").attr("lang");
  if (htmlLang) languages.add(htmlLang.toLowerCase());
  const languageCount = Math.max(1, languages.size);

  const hasForm = $("form").length > 0;

  const navHrefs = $("a[href]")
    .map((_, el) => ($(el).attr("href") ?? "").toLowerCase())
    .get();
  const hasBlog = navHrefs.some((h) => /\/(blog|nyheter|aktuelt|artikler|news)\b/.test(h));

  let complexityTier: ScanSignals["complexityTier"] = "enkel";
  if (ecommerce || isSpaFramework) complexityTier = "avansert";
  else if (hasForm || hasBlog || cms === "WordPress") complexityTier = "middels";

  return {
    complexityTier,
    ecommerce,
    multiLanguage: languageCount > 1,
    languageCount,
    hasForm,
    hasBlog,
    cms,
    isSpaFramework,
  };
}

export interface SiteScanResult {
  url: string;
  signals: ScanSignals;
  phaseHours: Record<PhaseKey, number>;
  summary: string;
  tags: string[];
  companyNameGuess: string;
}

function extractMeta($: cheerio.CheerioAPI): { title: string | null; description: string | null } {
  const title =
    $("title").first().text().trim() || $('meta[property="og:title"]').attr("content")?.trim() || null;
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;
  return { title: title || null, description: description || null };
}

// Bruker meta-beskrivelsen når den finnes (det er allerede en kort, tiltenkt
// oppsummering av siden) — ellers en enkel, deterministisk setning bygget av
// de samme signalene som styrer timeanslaget. Ingen KI-kall her; skanningen
// skal være rask og forutsigbar som resten av verktøyet.
function buildSummary(
  meta: { title: string | null; description: string | null },
  signals: ScanSignals
): string {
  if (meta.description && meta.description.length > 15) {
    return meta.description.length > 240 ? `${meta.description.slice(0, 237)}…` : meta.description;
  }
  const name = meta.title || "Nettsiden";
  const cmsPart = signals.cms ? ` bygget med ${signals.cms}` : "";
  const extras: string[] = [];
  if (signals.hasBlog) extras.push("blogg");
  if (signals.ecommerce) extras.push("nettbutikk");
  if (signals.hasForm) extras.push("kontaktskjema");
  if (signals.multiLanguage) extras.push(`${signals.languageCount} språk`);
  const extrasPart = extras.length ? ` Inneholder ${extras.join(", ")}.` : "";
  return `${name} er en nettside${cmsPart} med ca. ${signals.pageCount} sider.${extrasPart}`;
}

function buildTags(signals: ScanSignals): string[] {
  const tags: string[] = [];
  if (signals.hasBlog) tags.push("Blogg");
  if (signals.ecommerce) tags.push("Nettbutikk");
  if (signals.hasForm) tags.push("Kontaktskjema");
  if (signals.multiLanguage) tags.push(`Flerspråklig (${signals.languageCount})`);
  if (signals.isSpaFramework) tags.push("Enkeltsideapp");
  return tags;
}

export async function scanWebsite(input: string): Promise<SiteScanResult | null> {
  const url = normalizeUrl(input);
  if (!url) return null;
  const origin = new URL(url).origin;

  const html = await fetchText(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const partialSignals = detectSignals($, html);
  const sitemapCount = await countSitemapPages(origin);

  const pageCount = sitemapCount ?? Math.max(1, countHomepageLinks($, origin));
  const pageCountSource: ScanSignals["pageCountSource"] = sitemapCount
    ? "sitemap"
    : pageCount > 1
      ? "forside"
      : "ukjent";

  // Store, tettpakkede sitemaps sier lite om reell kompleksitet per side —
  // demp tieren litt oppover ved svært mange sider selv om andre signaler er svake.
  let complexityTier = partialSignals.complexityTier;
  if (complexityTier === "enkel" && pageCount > 60) complexityTier = "middels";

  const signals: ScanSignals = { ...partialSignals, complexityTier, pageCount, pageCountSource };
  const phaseHours = estimateHours(signals);
  const meta = extractMeta($);
  const summary = buildSummary(meta, signals);
  const tags = buildTags(signals);

  const domain = new URL(origin).hostname.replace(/^www\./, "");
  const ogSiteName = $('meta[property="og:site_name"]').attr("content")?.trim();
  const companyNameGuess = ogSiteName || (meta.title ? cleanTitle(meta.title) : fallbackNameFromDomain(domain));

  return { url, signals, phaseHours, summary, tags, companyNameGuess };
}
