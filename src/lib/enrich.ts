import * as cheerio from "cheerio";

// E-postleverandører der domenet ikke sier noe om firmaet.
const FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.no",
  "outlook.com",
  "outlook.no",
  "live.com",
  "live.no",
  "msn.com",
  "yahoo.com",
  "yahoo.no",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "online.no",
  "getmail.no",
  "epost.no",
  "aol.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "yandex.com",
]);

export function domainFromEmail(email: string): string | null {
  const at = email.trim().toLowerCase().split("@");
  if (at.length !== 2 || !at[1].includes(".")) return null;
  const domain = at[1];
  return FREE_PROVIDERS.has(domain) ? null : domain;
}

export function fallbackNameFromDomain(domain: string): string {
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function logoUrlForDomain(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function cleanTitle(title: string): string {
  // "Forside – Firma AS" / "Firma AS | Vi leverer x" → velg segmentet som ligner mest på et firmanavn
  const segments = title
    .split(/\s*[|–—·«»]\s*|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return title.trim();
  const generic = /^(hjem|forside|home|welcome|velkommen|start)$/i;
  const candidates = segments.filter((s) => !generic.test(s));
  if (candidates.length === 0) return segments[0];
  // Korteste ikke-generiske segment er som regel navnet
  return candidates.reduce((a, b) => (b.length < a.length ? b : a));
}

export interface Enrichment {
  companyName: string;
  website: string | null;
  logoUrl: string | null;
  domain: string | null;
}

export async function enrichFromEmail(email: string): Promise<Enrichment> {
  const domain = domainFromEmail(email);
  if (!domain) {
    return { companyName: "", website: null, logoUrl: null, domain: null };
  }

  const website = `https://${domain}`;
  let companyName = fallbackNameFromDomain(domain);

  const html =
    (await fetchHtml(website)) ?? (await fetchHtml(`https://www.${domain}`));
  if (html) {
    const $ = cheerio.load(html);
    const siteName =
      $('meta[property="og:site_name"]').attr("content")?.trim() ||
      $('meta[name="application-name"]').attr("content")?.trim();
    const title = $("title").first().text().trim();
    if (siteName) {
      companyName = siteName;
    } else if (title) {
      companyName = cleanTitle(title);
    }
  }

  return { companyName, website, logoUrl: logoUrlForDomain(domain), domain };
}
