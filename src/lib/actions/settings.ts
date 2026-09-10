"use server";

import bcrypt from "bcryptjs";
import {
  deleteObject } from "@/lib/objectStorage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  db,
  users,
  companies,
  deals,
  activities,
  contactEvents,
  emailAccounts,
  emailAccessGrants,
  dealOwners,
  pipelines,
  stages,
  businessUnits,
  calendarAccounts,
  lostReasons,
  tags,
  dealTags,
  personTags,
  companyTags,
  salesTargets,
  monthlyActuals,
  businessUnitTargets,
  notifications } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import { formatMoney } from "@/lib/format";
import {
  bulkDealMessageContext,
  formatNameList,
  revalidateDealTagViews,
  revalidateDealViews } from "./_shared";

// ---------- Egne selskap (business units) ----------

export async function createBusinessUnit(formData: FormData) {
  const me = await requireUser();
  if (!me.isAdmin) return null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return null;
  const existing = await db.query.businessUnits.findMany({
    orderBy: [asc(businessUnits.sortOrder)],
  });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [unit] = await db
    .insert(businessUnits)
    .values({ name, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return unit;
}

export async function updateBusinessUnit(id: number, formData: FormData) {
  const me = await requireUser();
  if (!me.isAdmin) return;
  const set: Record<string, unknown> = {};
  if (formData.has("name")) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    set.name = name;
  }
  if (formData.has("orgNumber")) {
    set.orgNumber = String(formData.get("orgNumber") ?? "").replace(/\D/g, "") || null;
  }
  if (Object.keys(set).length === 0) return;
  await db.update(businessUnits).set(set).where(eq(businessUnits.id, id));
  revalidatePath("/settings");
}

export async function deleteBusinessUnit(
  id: number
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  if (!me.isAdmin) return { ok: false, message: "Krever administratortilgang." };
  const usedByUser = await db.query.users.findFirst({
    where: eq(users.businessUnitId, id),
  });
  if (usedByUser) {
    return {
      ok: false,
      message: "Kan ikke slette — flytt brukerne til et annet selskap først.",
    };
  }
  const usedByCompany = await db.query.companies.findFirst({
    where: eq(companies.businessUnitId, id),
  });
  if (usedByCompany) {
    return {
      ok: false,
      message: "Kan ikke slette — flytt kundene til et annet selskap først.",
    };
  }
  await db.delete(businessUnits).where(eq(businessUnits.id, id));
  revalidatePath("/settings");
  return { ok: true, message: "Selskapet ble slettet." };
}

export async function bulkSetCompanyBusinessUnit(
  companyIds: number[],
  businessUnitId: number | null
) {
  await requireUser();
  if (companyIds.length === 0) return;
  await db
    .update(companies)
    .set({ businessUnitId })
    .where(inArray(companies.id, companyIds));
  revalidateDealViews();
}

export async function setUserPassword(
  userId: number,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  if (!me.isAdmin) throw new Error("Kun administrator kan sette passord for andre");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { ok: false, message: "Passordet må være minst 8 tegn." };
  }
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(password, 12) })
    .where(eq(users.id, userId));
  return { ok: true, message: "Passordet ble oppdatert." };
}

// Blokkerer sletting dersom brukeren fortsatt eier data — samme mønster som
// deleteStage — for å unngå å bryte NOT NULL-fremmednøkler (foreign_keys=ON).
export async function deleteUser(
  userId: number
): Promise<{ ok: boolean; message: string }> {
  const me = await requireUser();
  if (!me.isAdmin) throw new Error("Kun administrator kan slette brukere");
  if (userId === me.id) {
    return { ok: false, message: "Du kan ikke slette deg selv." };
  }
  const ownsDeals = await db.query.deals.findFirst({ where: eq(deals.ownerId, userId) });
  if (ownsDeals) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren eier deals. Overfør dem til en annen bruker først.",
    };
  }
  const coOwns = await db.query.dealOwners.findFirst({ where: eq(dealOwners.userId, userId) });
  if (coOwns) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren er med-eier på en eller flere deals.",
    };
  }
  const hasEmail = await db.query.emailAccounts.findFirst({ where: eq(emailAccounts.userId, userId) });
  if (hasEmail) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren har en e-postkonto koblet til. Fjern den først.",
    };
  }
  const hasCalendar = await db.query.calendarAccounts.findFirst({
    where: eq(calendarAccounts.userId, userId),
  });
  if (hasCalendar) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren har en kalenderkonto koblet til. Fjern den først.",
    };
  }
  const hasAccessGrant = await db.query.emailAccessGrants.findFirst({
    where: or(
      eq(emailAccessGrants.ownerUserId, userId),
      eq(emailAccessGrants.granteeUserId, userId)
    ),
  });
  if (hasAccessGrant) {
    return {
      ok: false,
      message: "Kan ikke slette — brukeren har innsynsforespørsler koblet til seg.",
    };
  }
  await db.update(contactEvents).set({ userId: null }).where(eq(contactEvents.userId, userId));
  await db.update(activities).set({ userId: null }).where(eq(activities.userId, userId));
  await db
    .update(notifications)
    .set({ actorUserId: null })
    .where(eq(notifications.actorUserId, userId));
  // Profilbildet ligger i R2 og forsvinner ikke av seg selv når raden gjør det.
  const avatarKey = (
    await db
      .select({ key: users.avatarObjectKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0]?.key;
  await db.delete(users).where(eq(users.id, userId));
  if (avatarKey) await deleteObject(avatarKey).catch(() => {});
  revalidatePath("/settings");
  return { ok: true, message: "Brukeren ble slettet." };
}


// ---------- Tapte grunner (lost reasons) ----------

export async function createLostReason(formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;
  const existing = await db.query.lostReasons.findMany({
    orderBy: [asc(lostReasons.sortOrder)],
  });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [reason] = await db
    .insert(lostReasons)
    .values({ label, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return reason;
}

export async function updateLostReason(id: number, formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await db.update(lostReasons).set({ label }).where(eq(lostReasons.id, id));
  revalidatePath("/settings");
}

export async function deleteLostReason(
  id: number
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const inUse = await db.query.deals.findFirst({ where: eq(deals.lostReasonId, id) });
  if (inUse) {
    return {
      ok: false,
      message: "Kan ikke slette — den er i bruk på minst én deal.",
    };
  }
  await db.delete(lostReasons).where(eq(lostReasons.id, id));
  revalidatePath("/settings");
  return { ok: true, message: "Grunnen ble slettet." };
}

// `orderedIds` er hele lista i sin nye rekkefølge.
export async function reorderLostReasons(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(lostReasons).set({ sortOrder: i }).where(eq(lostReasons.id, orderedIds[i]));
  }
  revalidatePath("/settings");
}


// ---------- Tagger (deals, personer og bedrifter) ----------
// Fritt redigerbare per entitetstype, samme mønster som tapt-grunner —
// forhåndsdefinerte via seedTags i migrate.ts, men kan utvides/omdøpes/
// slettes fra Innstillinger etterpå.

export async function createTag(
  entityType: "deal" | "person" | "company",
  formData: FormData
) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;
  const existing = await db.query.tags.findMany({
    where: eq(tags.entityType, entityType),
    orderBy: [asc(tags.sortOrder)],
  });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [tag] = await db
    .insert(tags)
    .values({ entityType, label, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return tag;
}

export async function updateTag(id: number, formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await db.update(tags).set({ label }).where(eq(tags.id, id));
  revalidatePath("/settings");
}

// Ingen "i bruk"-sperre som på tapt-grunner — en tag er trygg å slette når
// den er i bruk, siden den bare fjernes fra det den var koblet til
// (fremmednøklene har ON DELETE CASCADE på selve koblingstabellene).
export async function deleteTag(id: number): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  await db.delete(tags).where(eq(tags.id, id));
  revalidatePath("/settings");
  revalidateDealViews();
  revalidatePath("/people");
  return { ok: true, message: "Taggen ble slettet." };
}

// `orderedIds` er hele lista (for én entitetstype) i sin nye rekkefølge.
export async function reorderTags(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(tags).set({ sortOrder: i }).where(eq(tags.id, orderedIds[i]));
  }
  revalidatePath("/settings");
}

export async function addDealTag(dealId: number, tagId: number) {
  await requireUser();
  await db.insert(dealTags).values({ dealId, tagId }).onConflictDoNothing();
  revalidateDealTagViews(dealId);
}

export async function removeDealTag(dealId: number, tagId: number) {
  await requireUser();
  await db.delete(dealTags).where(and(eq(dealTags.dealId, dealId), eq(dealTags.tagId, tagId)));
  revalidateDealTagViews(dealId);
}

// Brukes fra bulk-verktøylinjen i Pipeline-listen — legger til (ikke
// fjerner) samme tag på flere valgte deals samtidig.
export async function bulkAddDealTag(dealIds: number[], tagId: number) {
  await requireUser();
  if (dealIds.length === 0) return;
  await db
    .insert(dealTags)
    .values(dealIds.map((dealId) => ({ dealId, tagId })))
    .onConflictDoNothing();
  revalidateDealTagViews();
}

export async function addPersonTag(personId: number, tagId: number) {
  await requireUser();
  await db.insert(personTags).values({ personId, tagId }).onConflictDoNothing();
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function removePersonTag(personId: number, tagId: number) {
  await requireUser();
  await db
    .delete(personTags)
    .where(and(eq(personTags.personId, personId), eq(personTags.tagId, tagId)));
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

// Brukes fra bulk-verktøylinjen i Personer-listen — samme "legg til, ikke
// fjern"-oppførsel som bulkAddDealTag.
export async function bulkAddPersonTag(personIds: number[], tagId: number) {
  await requireUser();
  if (personIds.length === 0) return;
  await db
    .insert(personTags)
    .values(personIds.map((personId) => ({ personId, tagId })))
    .onConflictDoNothing();
  revalidatePath("/people");
}

export async function addCompanyTag(companyId: number, tagId: number) {
  await requireUser();
  await db.insert(companyTags).values({ companyId, tagId }).onConflictDoNothing();
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
}

export async function removeCompanyTag(companyId: number, tagId: number) {
  await requireUser();
  await db
    .delete(companyTags)
    .where(and(eq(companyTags.companyId, companyId), eq(companyTags.tagId, tagId)));
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
}

// Brukes fra bulk-verktøylinjen i Bedrifter-listen — samme "legg til, ikke
// fjern"-oppførsel som bulkAddDealTag/bulkAddPersonTag.
export async function bulkAddCompanyTag(companyIds: number[], tagId: number) {
  await requireUser();
  if (companyIds.length === 0) return;
  await db
    .insert(companyTags)
    .values(companyIds.map((companyId) => ({ companyId, tagId })))
    .onConflictDoNothing();
  revalidatePath("/companies");
}


// ---------- Salgsmål ----------

// Kvartalsfordelingen er universell — samme prosentsplitt brukes på tvers av
// alle selskap, i stedet for at hvert selskap satte sin egen (som i praksis
// aldri ble lest noe sted). Selve årsmålet er ikke lenger et eget felt her —
// det er summen av business_unit_targets, se getSalesTarget-forbrukerne i
// settings/page.tsx og statistikk/page.tsx.
export async function updateSalesTarget(
  year: number,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const q1Weight = Number(formData.get("q1Weight"));
  const q2Weight = Number(formData.get("q2Weight"));
  const q3Weight = Number(formData.get("q3Weight"));
  const q4Weight = Number(formData.get("q4Weight"));
  if (![q1Weight, q2Weight, q3Weight, q4Weight].every(Number.isFinite)) {
    return { ok: false, message: "Ugyldig tall." };
  }
  const weightSum = q1Weight + q2Weight + q3Weight + q4Weight;
  if (Math.round(weightSum) !== 100) {
    return { ok: false, message: `Kvartalsvektene må summere til 100 % (er nå ${weightSum} %).` };
  }

  const existing = await db.query.salesTargets.findFirst({ where: eq(salesTargets.year, year) });
  const set = { q1Weight, q2Weight, q3Weight, q4Weight };
  if (existing) {
    await db.update(salesTargets).set(set).where(eq(salesTargets.id, existing.id));
  } else {
    await db.insert(salesTargets).values({ year, totalAmount: 0, ...set });
  }
  revalidatePath("/settings");
  revalidatePath("/statistikk");
  return { ok: true, message: "Kvartalsfordeling oppdatert." };
}

// Tom/fjernet verdi (amount === null) sletter raden — måneden faller da
// tilbake til å regnes ut fra vunnet-deals i denne appen i stedet, se
// salesTarget.server.ts.
export async function upsertMonthlyActual(year: number, month: number, formData: FormData) {
  await requireUser();
  const raw = String(formData.get("amount") ?? "").replace(/\D/g, "");
  const amount = raw ? Number(raw) : null;

  const existing = await db.query.monthlyActuals.findFirst({
    where: and(eq(monthlyActuals.year, year), eq(monthlyActuals.month, month)),
  });
  if (amount == null) {
    if (existing) await db.delete(monthlyActuals).where(eq(monthlyActuals.id, existing.id));
  } else if (existing) {
    await db.update(monthlyActuals).set({ amount }).where(eq(monthlyActuals.id, existing.id));
  } else {
    await db.insert(monthlyActuals).values({ year, month, amount });
  }
  revalidatePath("/settings");
  revalidatePath("/statistikk");
}

// Bryter salgsmålet ned per eget selskap (business_units) — se
// businessUnitTargets i schema.ts for hvorfor dette er en egen tabell i
// stedet for en nullable business_unit_id på sales_targets. Selve
// kvartalsfordelingen er universell (se updateSalesTarget) og settes ikke
// per selskap lenger — q1-q4-kolonnene her beholder bare sin DEFAULT-verdi
// og leses ikke noe sted.
export async function updateBusinessUnitTarget(
  year: number,
  businessUnitId: number,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const totalAmount = Number(String(formData.get("totalAmount") ?? "").replace(/\D/g, ""));
  const manualActualAmount = Number(
    String(formData.get("manualActualAmount") ?? "0").replace(/\D/g, "") || "0"
  );
  if (!Number.isFinite(totalAmount) || !Number.isFinite(manualActualAmount)) {
    return { ok: false, message: "Ugyldig tall." };
  }

  const existing = await db.query.businessUnitTargets.findFirst({
    where: and(eq(businessUnitTargets.year, year), eq(businessUnitTargets.businessUnitId, businessUnitId)),
  });
  if (existing) {
    await db
      .update(businessUnitTargets)
      .set({ totalAmount, manualActualAmount })
      .where(eq(businessUnitTargets.id, existing.id));
  } else {
    await db.insert(businessUnitTargets).values({ year, businessUnitId, totalAmount, manualActualAmount });
  }
  revalidatePath("/settings");
  revalidatePath("/statistikk");
  return { ok: true, message: "Salgsmål oppdatert." };
}


// ---------- Faser (pipeline-stages) ----------

export async function createStage(pipelineId: number, formData: FormData) {
  await requireUser();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;
  const color = String(formData.get("color") ?? "").trim() || "#8e8e93";
  const existing = await db.query.stages.findMany({ orderBy: [asc(stages.sortOrder)] });
  const inPipeline = existing.filter((s) => s.pipelineId === pipelineId);
  const nextOrder = inPipeline.length > 0 ? inPipeline[inPipeline.length - 1].sortOrder + 1 : 0;
  const [stage] = await db
    .insert(stages)
    .values({ pipelineId, label, color, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  revalidateDealViews();
  return stage;
}

export async function updateStage(stageId: number, formData: FormData) {
  await requireUser();
  const set: Record<string, unknown> = {};
  if (formData.has("label")) {
    const label = String(formData.get("label") ?? "").trim();
    if (label) set.label = label;
  }
  if (formData.has("color")) {
    set.color = String(formData.get("color") ?? "").trim() || "#8e8e93";
  }
  if (formData.has("isWon")) set.isWon = formData.get("isWon") === "1";
  if (formData.has("isLost")) set.isLost = formData.get("isLost") === "1";
  if (formData.has("probability")) {
    const p = Number(formData.get("probability"));
    if (Number.isFinite(p)) set.probability = Math.max(0, Math.min(100, Math.round(p)));
  }
  if (Object.keys(set).length === 0) return;
  await db.update(stages).set(set).where(eq(stages.id, stageId));
  revalidatePath("/settings");
  revalidateDealViews();
}

export async function deleteStage(
  stageId: number
): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const inUse = await db.query.deals.findFirst({ where: eq(deals.stage, String(stageId)) });
  if (inUse) {
    return {
      ok: false,
      message: "Kan ikke slette — flytt deals ut av fasen først.",
    };
  }
  await db.delete(stages).where(eq(stages.id, stageId));
  revalidatePath("/settings");
  revalidateDealViews();
  return { ok: true, message: "Fasen ble slettet." };
}

// `orderedIds` er hele fase-listen i sin nye rekkefølge.
export async function reorderStages(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(stages).set({ sortOrder: i }).where(eq(stages.id, orderedIds[i]));
  }
  revalidatePath("/settings");
  revalidateDealViews();
}


// ---------- Pipelines ----------
// Egne pipeline-løp (f.eks. "Salg", "Anbud"), hver med sitt eget sett
// stages — se stages.pipelineId. Samme CRUD-mønster som business_units.

export async function createPipeline(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return null;
  const existing = await db.query.pipelines.findMany({ orderBy: [asc(pipelines.sortOrder)] });
  const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [pipeline] = await db
    .insert(pipelines)
    .values({ name, sortOrder: nextOrder })
    .returning();
  revalidatePath("/settings");
  return pipeline;
}

export async function renamePipeline(id: number, formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.update(pipelines).set({ name }).where(eq(pipelines.id, id));
  revalidatePath("/settings");
}

export async function deletePipeline(id: number): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const all = await db.query.pipelines.findMany();
  if (all.length <= 1) {
    return { ok: false, message: "Kan ikke slette den siste pipelinen." };
  }
  const stageIds = (
    await db.query.stages.findMany({ where: eq(stages.pipelineId, id) })
  ).map((s) => String(s.id));
  if (stageIds.length > 0) {
    const inUse = await db.query.deals.findFirst({ where: inArray(deals.stage, stageIds) });
    if (inUse) {
      return {
        ok: false,
        message: "Kan ikke slette — flytt deals ut av pipelinens faser først.",
      };
    }
  }
  await db.delete(stages).where(eq(stages.pipelineId, id));
  await db.delete(pipelines).where(eq(pipelines.id, id));
  revalidatePath("/settings");
  revalidateDealViews();
  return { ok: true, message: "Pipelinen ble slettet." };
}

// `orderedIds` er hele pipeline-listen i sin nye rekkefølge.
export async function reorderPipelines(orderedIds: number[]) {
  await requireUser();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(pipelines).set({ sortOrder: i }).where(eq(pipelines.id, orderedIds[i]));
  }
  revalidatePath("/settings");
}

export async function updateDealDetails(dealId: number, formData: FormData) {
  const me = await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) return;

  const title = String(formData.get("dealTitle") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const hasValueField = formData.has("value");
  const valueRaw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
  const hasProbabilityField = formData.has("probabilityOverride");
  const probabilityRaw = String(formData.get("probabilityOverride") ?? "").trim();
  const probabilityNum = probabilityRaw === "" ? null : Number(probabilityRaw);
  const probabilityOverride =
    probabilityNum != null && Number.isFinite(probabilityNum)
      ? Math.max(0, Math.min(100, Math.round(probabilityNum)))
      : null;

  const companyName = String(formData.get("companyName") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim() || null;

  // De tre skrivingene under er uavhengige av hverandre (ulike rader/
  // tabeller) — kjøres samtidig i stedet for i serie.
  await Promise.all([
    comment !== deal.comment
      ? db.insert(activities).values({
          dealId,
          userId: me.id,
          type: "comment",
          content: comment ? `Oppdaterte kommentaren: «${comment}»` : "Fjernet kommentaren",
        })
      : Promise.resolve(),
    db
      .update(deals)
      .set({
        ...(title ? { title } : {}),
        comment,
        // Verdi styres av varelinjene når de finnes; da sendes ikke feltet inn.
        ...(hasValueField ? { value: valueRaw ? Number(valueRaw) : null } : {}),
        ...(hasProbabilityField ? { probabilityOverride } : {}),
        updatedAt: new Date(),
      })
      .where(eq(deals.id, dealId)),
    db
      .update(companies)
      .set({ ...(companyName ? { name: companyName } : {}), website })
      .where(eq(companies.id, deal.companyId)),
  ]);

  revalidateDealViews(dealId);
}

// Klikk-for-å-endre-navn direkte på deal-siden (overskriften). Returnerer
// den nye, gjeldende slug-en slik at klienten kan oppdatere adressefeltet.
export async function renameDeal(dealId: number, title: string): Promise<{ slug: string } | null> {
  await requireUser();
  const trimmed = title.trim();
  if (!trimmed) return null;
  await db.update(deals).set({ title: trimmed, updatedAt: new Date() }).where(eq(deals.id, dealId));
  revalidateDealViews(dealId);
  const slug = (await getDealSlugMap()).get(dealId) ?? String(dealId);
  return { slug };
}

// Inline-redigering fra listevisningen: kun feltene som sendes inn oppdateres.
export async function updateDealInline(dealId: number, formData: FormData) {
  const me = await requireUser();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  let newComment: string | null | undefined;

  if (formData.has("title")) {
    const title = String(formData.get("title") ?? "").trim();
    if (title) set.title = title;
  }
  if (formData.has("comment")) {
    newComment = String(formData.get("comment") ?? "").trim() || null;
    set.comment = newComment;
  }
  if (formData.has("followUpAt")) {
    const dateStr = String(formData.get("followUpAt") ?? "");
    set.followUpAt = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  }
  if (formData.has("value")) {
    const valueRaw = String(formData.get("value") ?? "").replace(/[^\d]/g, "");
    set.value = valueRaw ? Number(valueRaw) : null;
  }

  // Selve oppdateringen starter med det samme — den er uavhengig av
  // kommentar-sjekken under, så de to kjører samtidig i stedet for i serie.
  const updatePromise = db.update(deals).set(set).where(eq(deals.id, dealId));

  // Logges kun i "Notater og aktivitet" hvis kommentaren faktisk endres —
  // ellers ville hver blur på et uendret felt skapt en aktivitetsrad.
  if (newComment !== undefined) {
    const current = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
    if (current && current.comment !== newComment) {
      await db.insert(activities).values({
        dealId,
        userId: me.id,
        type: "comment",
        content: newComment ? `Oppdaterte kommentaren: «${newComment}»` : "Fjernet kommentaren",
      });
    }
  }

  await updatePromise;
  revalidateDealViews(dealId);
}

export async function setFollowUp(dealId: number, formData: FormData) {
  const me = await requireUser();
  const dateStr = String(formData.get("followUpAt") ?? "");
  const date = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  await db
    .update(deals)
    .set({ followUpAt: date, updatedAt: new Date() })
    .where(eq(deals.id, dealId));
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "followup",
    content: date
      ? `Oppfølging satt til ${date.toLocaleDateString("nb-NO", { day: "numeric", month: "long" })}`
      : "Oppfølging fjernet",
  });
  revalidateDealViews(dealId);
}

// Setter samme oppfølgingsdato på flere valgte deals samtidig, fra
// flervalg i listevisningen.
export async function bulkSetFollowUp(dealIds: number[], dateStr: string) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const date = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  await db
    .update(deals)
    .set({ followUpAt: date, updatedAt: new Date() })
    .where(inArray(deals.id, dealIds));
  await db.insert(activities).values(
    dealIds.map((dealId) => ({
      dealId,
      userId: me.id,
      type: "followup",
      content: date
        ? `Oppfølging satt til ${date.toLocaleDateString("nb-NO", { day: "numeric", month: "long" })}`
        : "Oppfølging fjernet",
    }))
  );
  revalidateDealViews();
}

export async function deleteDeal(dealId: number) {
  await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal) redirect("/leads");
  await db.delete(deals).where(eq(deals.id, dealId));
  // Rydd bort selskapet hvis dette var siste deal og ingen e-post er logget.
  const remaining = await db.query.deals.findFirst({
    where: eq(deals.companyId, deal.companyId),
  });
  if (!remaining) {
    const hasMail = await db.query.emailMessages.findFirst({
      where: (m, { eq: eqOp }) => eqOp(m.companyId, deal.companyId),
    });
    if (!hasMail) {
      await db.delete(companies).where(eq(companies.id, deal.companyId));
    }
  }
  revalidateDealViews();
  redirect("/leads");
}

// Flytter flere deals til samme fase samtidig, fra flervalg i listevisningen.
export async function bulkSetDealStage(dealIds: number[], stage: string) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const stageRow = await db.query.stages.findFirst({ where: eq(stages.id, Number(stage)) });

  const set: Record<string, unknown> = { stage, updatedAt: new Date() };
  if (stageRow?.isWon) set.closedAt = new Date();
  await db.update(deals).set(set).where(inArray(deals.id, dealIds));

  if (stageRow?.isWon) {
    // Hver deal har eget selskap/verdi/tagget-liste, så meldingen bygges per
    // deal — men selskapsnavn og eier/med-eier-navn hentes i tre batchede
    // spørringer (bulkDealMessageContext) i stedet for to per deal.
    const targetDeals = await db.query.deals.findMany({ where: inArray(deals.id, dealIds) });
    const { companyNameById, namesFor } = await bulkDealMessageContext(targetDeals);
    await db.insert(activities).values(
      targetDeals.map((deal) => ({
        dealId: deal.id,
        userId: me.id,
        type: "won",
        content: `${formatNameList(namesFor(deal))} solgte «${deal.title}» til ${
          companyNameById.get(deal.companyId) ?? "kunden"
        } for ${formatMoney(deal.value ?? 0)}! 🎉`,
      }))
    );
  } else {
    await db.insert(activities).values(
      dealIds.map((dealId) => ({
        dealId,
        userId: me.id,
        type: "stage",
        content: `Flyttet til «${stageRow?.label ?? stage}»`,
      }))
    );
  }
  revalidateDealViews();
}
