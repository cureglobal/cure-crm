"use server";

import {
  deleteObject } from "@/lib/objectStorage";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  db,
  companies,
  deals,
  activities,
  contactEvents,
  emailAccounts,
  dealLines,
  referenceProjects } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  sendQuoteLimiter } from "@/lib/rateLimit";
import {
  type BrregHit } from "@/lib/brreg";
import { getDefaultStageId } from "@/lib/stages.server";
import { getDefaultPipelineId } from "@/lib/pipelines.server";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import { scanWebsite, type SiteScanResult } from "@/lib/siteScan";
import { PHASES } from "@/lib/estimator";
import * as companyInsight from "@/lib/companyInsight";
import { generateQuotePdf } from "@/lib/pdf";
import { sendMailFromAccount } from "@/lib/mailer";
import { formatDateShort } from "@/lib/format";
import {
  lineMultiplier,
  recalcDealValue,
  revalidateDealViews,
  storeUploadedImage,
  todayFollowUpDate } from "./_shared";
import { autoMatchCompany, syncCompanyFromBrreg } from "./companies";

// ---------- Prisverktøy ----------

export async function scanWebsiteForEstimate(
  url: string
): Promise<{ ok: true; result: SiteScanResult } | { ok: false; message: string }> {
  await requireUser();
  const result = await scanWebsite(url);
  if (!result) {
    return {
      ok: false,
      message: "Fant ikke siden, eller den svarte ikke innen rimelig tid. Sjekk adressen.",
    };
  }
  return { ok: true, result };
}

function domainFromUrlInput(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function lookupCompanyInsight(
  url: string,
  companyNameGuess: string,
  ecommerceDetected: boolean
) {
  await requireUser();
  return companyInsight.lookupCompanyInsight(companyNameGuess, domainFromUrlInput(url), ecommerceDetected);
}

export async function lookupCompanyInsightByOrgNumber(
  orgNumber: string,
  candidates: BrregHit[],
  ecommerceDetected: boolean
) {
  await requireUser();
  return companyInsight.lookupCompanyInsightByOrgNumber(orgNumber, candidates, ecommerceDetected);
}

export interface EstimateLineInput {
  title: string;
  hours: number;
  rate: number;
}

// Erstatter ALLE varelinjer på dealen med det nye estimatet — "lagre" her
// betyr synkronisere, ikke legge til på toppen av det som var der fra før.
export async function saveEstimateToDeal(
  dealId: number,
  lines: EstimateLineInput[]
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return { ok: false, message: "Fant ikke dealen." };

  const clean = lines
    .map((l) => ({ title: l.title.trim(), hours: Number(l.hours), rate: Number(l.rate) }))
    .filter((l) => l.title && Number.isFinite(l.hours) && Number.isFinite(l.rate));

  if (clean.length === 0) {
    return { ok: false, message: "Ingen gyldige rader å lagre." };
  }

  await db.delete(dealLines).where(eq(dealLines.dealId, dealId));
  await db.insert(dealLines).values(clean.map((l) => ({ dealId, ...l })));
  await recalcDealValue(dealId);

  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "estimate",
    content: "Varelinjer oppdatert fra prisverktøyet",
  });

  revalidateDealViews(dealId);
  return { ok: true, message: `Lagret ${clean.length} rader på ${deal.title}.` };
}

// Oppretter en helt ny deal (og evt. nytt selskap) direkte fra prisverktøyet,
// og lagrer estimatet på den med det samme — uten å forlate siden, slik at
// brukeren kan sende tilbudet til kunden rett etterpå.
export async function createDealFromEstimate(
  formData: FormData,
  lines: EstimateLineInput[]
): Promise<
  | { ok: true; dealId: number; dealSlug: string; companyName: string; logoUrl: string | null }
  | { ok: false; message: string }
> {
  const me = await requireUser();
  const companyIdRaw = String(formData.get("companyId") ?? "").trim();
  const newCompanyName = String(formData.get("companyName") ?? "").trim();
  const orgNumber = String(formData.get("orgNumber") ?? "").replace(/\D/g, "");
  const dealTitle = String(formData.get("dealTitle") ?? "").trim();

  const chosenId = Number(companyIdRaw);
  let company =
    companyIdRaw && Number.isFinite(chosenId)
      ? await db.query.companies.findFirst({ where: eq(companies.id, chosenId) })
      : undefined;

  if (!company && !newCompanyName) {
    return { ok: false, message: "Velg eller opprett et selskap først." };
  }

  if (!company) {
    [company] = await db
      .insert(companies)
      .values({
        name: newCompanyName,
        orgNumber: orgNumber.length === 9 ? orgNumber : null,
      })
      .returning();

    if (orgNumber.length === 9) {
      await syncCompanyFromBrreg(company.id, orgNumber, { verified: true });
    } else {
      await autoMatchCompany(company.id);
    }
  }

  const [deal] = await db
    .insert(deals)
    .values({
      companyId: company.id,
      title: dealTitle || "Ny deal",
      ownerId: me.id,
      stage: await getDefaultStageId(await getDefaultPipelineId()),
      followUpAt: todayFollowUpDate(),
    })
    .returning();

  await db.insert(activities).values({
    dealId: deal.id,
    userId: me.id,
    type: "created",
    content: "Deal opprettet fra prisverktøyet",
  });

  await saveEstimateToDeal(deal.id, lines);

  revalidateDealViews(deal.id);
  const dealSlug = (await getDealSlugMap()).get(deal.id) ?? String(deal.id);
  return {
    ok: true,
    dealId: deal.id,
    dealSlug,
    companyName: company.name,
    logoUrl: company.logoUrl,
  };
}


// ---------- Referanseprosjekter ----------

export async function createReferenceProject(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const url = String(formData.get("url") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const screenshotRaw = String(formData.get("screenshot") ?? "").trim();
  // Kan være tom (valgfritt felt) eller allerede en URL fra et tidligere
  // lagret prosjekt; kun ekte data-URL-er skal lastes opp på nytt.
  const storedShot = screenshotRaw.startsWith("data:image/")
    ? await storeUploadedImage(screenshotRaw, "reference")
    : null;

  const phaseHours: Record<string, { estimert?: number; faktisk?: number }> = {};
  for (const phase of PHASES) {
    const estRaw = String(formData.get(`est_${phase.key}`) ?? "").replace(",", ".");
    const actRaw = String(formData.get(`act_${phase.key}`) ?? "").replace(",", ".");
    const est = estRaw ? Number(estRaw) : null;
    const act = actRaw ? Number(actRaw) : null;
    if ((est && est > 0) || (act && act > 0)) {
      phaseHours[phase.key] = {
        ...(est && est > 0 ? { estimert: est } : {}),
        ...(act && act > 0 ? { faktisk: act } : {}),
      };
    }
  }

  await db.insert(referenceProjects).values({
    name,
    url,
    notes,
    screenshot: storedShot?.url ?? null,
    screenshotObjectKey: storedShot?.key ?? null,
    phaseHours: Object.keys(phaseHours).length > 0 ? JSON.stringify(phaseHours) : null,
  });

  revalidatePath("/estimat");
}

export async function deleteReferenceProject(id: number) {
  await requireUser();
  // Hent nøkkelen før raden forsvinner, ellers blir bildet liggende i R2
  // uten at noe peker på det.
  const existing = await db
    .select({ key: referenceProjects.screenshotObjectKey })
    .from(referenceProjects)
    .where(eq(referenceProjects.id, id))
    .limit(1);
  await db.delete(referenceProjects).where(eq(referenceProjects.id, id));
  const key = existing[0]?.key;
  if (key) await deleteObject(key).catch(() => {});
  revalidatePath("/estimat");
}


// ---------- Pristilbud på e-post ----------

export async function sendQuoteEmail(
  dealId: number,
  recipients: string[]
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  if (!sendQuoteLimiter.tryConsume(String(me.id))) {
    return { ok: false, message: "For mange tilbud sendt på kort tid — prøv igjen om litt." };
  }
  const clean = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) return { ok: false, message: "Velg minst én mottaker." };
  if (clean.length > 20) {
    return { ok: false, message: "Maks 20 mottakere per pristilbud." };
  }

  const account = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.userId, me.id),
  });
  if (!account) {
    return { ok: false, message: "Du må koble til e-postkontoen din i Innstillinger først." };
  }

  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return { ok: false, message: "Fant ikke dealen." };
  const company = await db.query.companies.findFirst({ where: eq(companies.id, deal.companyId) });
  if (!company) return { ok: false, message: "Fant ikke selskapet." };

  const lines = await db.query.dealLines.findMany({ where: eq(dealLines.dealId, dealId) });
  if (lines.length === 0) {
    return { ok: false, message: "Ingen varelinjer å sende — legg til priser under Varelinjer først." };
  }

  const dateLabel = formatDateShort(new Date());
  const pdfBuffer = await generateQuotePdf({
    companyName: company.name,
    dealTitle: deal.title,
    dateLabel,
    lines: lines.map((l) => ({
      title: l.billingType === "recurring" ? `${l.title} (× ${lineMultiplier(l)} mnd)` : l.title,
      sum: l.hours * l.rate * lineMultiplier(l),
    })),
  });

  const filename = `${company.name} - ${deal.title}, ${dateLabel}.pdf`;
  const subject = `Cure for ${company.name} - Pristilbud: ${deal.title}, ${dateLabel}`;
  const text = [`Hei,`, ``, `Se vedlagt PDF for estimat på pris for «${deal.title}».`]
    .concat(me.signature ? ["", me.signature] : [])
    .join("\n");

  try {
    await sendMailFromAccount(account, {
      fromName: me.name,
      to: clean,
      subject,
      text,
      attachment: { filename, content: pdfBuffer },
    });
  } catch (err) {
    // Rå SMTP/IMAP-feilmeldinger kan inneholde interne detaljer (auth-tokens,
    // interne verts-/portnummer) — logges i sin helhet server-side, men
    // brukeren får bare en generell melding.
    console.error("sendQuoteEmail feilet:", err);
    return {
      ok: false,
      message: "Sending feilet. Sjekk at e-postkontoen din i Innstillinger fortsatt er koblet til.",
    };
  }

  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "contact",
    content: `Pristilbud sendt til ${clean.join(", ")}`,
  });
  await db.insert(contactEvents).values({
    companyId: company.id,
    userId: me.id,
    kind: "tilbud",
    note: `${me.name} sendte tilbud på deal «${deal.title}».`,
    occurredAt: new Date(),
  });
  revalidateDealViews(dealId);

  return { ok: true, message: `Pristilbud sendt til ${clean.join(", ")}.` };
}
