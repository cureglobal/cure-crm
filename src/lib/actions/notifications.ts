"use server";

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  users,
  companies,
  deals,
  activities,
  dealOwners,
  notifications } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import {
  notifyDealOwnerAssigned,
  revalidateDealViews } from "./_shared";

// ---------- Varsler ----------
// Varsler den som ble satt som eier/med-eier, men KUN når det ikke er
// personen selv som gjorde det (ingen vits i å varsle deg om din egen
// handling). Deal-varselet henter companyId fra dealen selv — trenger ikke
// sendes inn av kalleren.



export interface NotificationDTO {
  id: number;
  actorName: string;
  dealId: number | null;
  dealTitle: string | null;
  dealSlug: string | null;
  companyId: number | null;
  companyName: string | null;
  readAt: number | null;
  createdAt: number;
}

// Siste 30 varsler til den innloggede brukeren — dealnavn/selskapsnavn slås
// opp på nytt her (ikke lagret på varselet selv), så de alltid viser
// gjeldende navn selv om dealen/selskapet er omdøpt siden varselet ble laget.
export async function listNotifications(): Promise<NotificationDTO[]> {
  const me = await requireUser();
  const rows = await db.query.notifications.findMany({
    where: eq(notifications.userId, me.id),
    orderBy: [desc(notifications.createdAt)],
    limit: 30,
  });
  if (rows.length === 0) return [];

  const actorIds = [
    ...new Set(rows.map((r) => r.actorUserId).filter((id): id is number => id != null)),
  ];
  const dealIds = [...new Set(rows.map((r) => r.dealId).filter((id): id is number => id != null))];
  const companyIds = [
    ...new Set(rows.map((r) => r.companyId).filter((id): id is number => id != null)),
  ];

  const [actors, dealRows, companyRows, slugMap] = await Promise.all([
    actorIds.length ? db.query.users.findMany({ where: inArray(users.id, actorIds) }) : Promise.resolve([]),
    dealIds.length ? db.query.deals.findMany({ where: inArray(deals.id, dealIds) }) : Promise.resolve([]),
    companyIds.length
      ? db.query.companies.findMany({ where: inArray(companies.id, companyIds) })
      : Promise.resolve([]),
    getDealSlugMap(),
  ]);
  const actorById = new Map(actors.map((a) => [a.id, a.name]));
  const dealById = new Map(dealRows.map((d) => [d.id, d.title]));
  const companyById = new Map(companyRows.map((c) => [c.id, c.name]));

  return rows.map((n) => ({
    id: n.id,
    actorName: (n.actorUserId != null ? actorById.get(n.actorUserId) : null) ?? "En bruker",
    dealId: n.dealId,
    dealTitle: n.dealId != null ? (dealById.get(n.dealId) ?? null) : null,
    dealSlug: n.dealId != null ? (slugMap.get(n.dealId) ?? String(n.dealId)) : null,
    companyId: n.companyId,
    companyName: n.companyId != null ? (companyById.get(n.companyId) ?? null) : null,
    readAt: n.readAt ? n.readAt.getTime() : null,
    createdAt: n.createdAt.getTime(),
  }));
}

export async function getUnreadNotificationCount(): Promise<number> {
  const me = await requireUser();
  const [{ value }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
  return value;
}

export async function markNotificationRead(id: number) {
  const me = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, me.id)));
}

export async function markAllNotificationsRead() {
  const me = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
}

// Endrer hoved-eieren på en enkelt deal — fra oversiktsbildet (listevisningen).
// ownerId === null fjerner hovedeieren — en deal kan stå uten eier.
export async function updateDealOwner(dealId: number, ownerId: number | null) {
  const me = await requireUser();
  if (ownerId == null) {
    await db.update(deals).set({ ownerId: null, updatedAt: new Date() }).where(eq(deals.id, dealId));
    await db.insert(activities).values({ dealId, userId: me.id, type: "owner", content: "Fjernet eier" });
    revalidateDealViews(dealId);
    return;
  }
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
  if (!owner) return;
  await db.update(deals).set({ ownerId, updatedAt: new Date() }).where(eq(deals.id, dealId));
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "owner",
    content: `Endret eier til ${owner.name}`,
  });
  await notifyDealOwnerAssigned(me.id, dealId, ownerId);
  revalidateDealViews(dealId);
}

// Samme som over, for flere valgte deals samtidig.
export async function bulkSetDealOwner(dealIds: number[], ownerId: number) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
  if (!owner) return;
  await db
    .update(deals)
    .set({ ownerId, updatedAt: new Date() })
    .where(inArray(deals.id, dealIds));
  await db.insert(activities).values(
    dealIds.map((dealId) => ({
      dealId,
      userId: me.id,
      type: "owner",
      content: `Endret eier til ${owner.name}`,
    }))
  );
  if (ownerId !== me.id) {
    const dealRows = await db
      .select({ id: deals.id, companyId: deals.companyId })
      .from(deals)
      .where(inArray(deals.id, dealIds));
    await db.insert(notifications).values(
      dealRows.map((d) => ({
        userId: ownerId,
        actorUserId: me.id,
        dealId: d.id,
        companyId: d.companyId,
      }))
    );
  }
  revalidateDealViews();
}

// Bytter hovedeier, men uten å miste den forrige — den blir med-eier i
// stedet for å falle helt av dealen. Brukes fra flervalg-eier-velgeren i
// Pipeline-listen (DealOwnerCell), der man kan velge flere eiere.
export async function swapDealMainOwner(dealId: number, newOwnerId: number) {
  const me = await requireUser();
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal || deal.ownerId === newOwnerId) return;
  const newOwner = await db.query.users.findFirst({ where: eq(users.id, newOwnerId) });
  if (!newOwner) return;
  const oldOwnerId = deal.ownerId;

  await db
    .update(deals)
    .set({ ownerId: newOwnerId, updatedAt: new Date() })
    .where(eq(deals.id, dealId));
  if (oldOwnerId != null) {
    await db.insert(dealOwners).values({ dealId, userId: oldOwnerId }).onConflictDoNothing();
  }
  await db
    .delete(dealOwners)
    .where(and(eq(dealOwners.dealId, dealId), eq(dealOwners.userId, newOwnerId)));
  await db.insert(activities).values({
    dealId,
    userId: me.id,
    type: "owner",
    content: `Endret hovedeier til ${newOwner.name}`,
  });
  revalidateDealViews(dealId);
}

// Legger til én med-eier på flere valgte deals samtidig — bulk-motstykket til
// addDealOwner, brukt fra "Legg til eier"-verktøylinjen i DealsTable.
export async function bulkAddDealOwner(dealIds: number[], userId: number) {
  const me = await requireUser();
  if (dealIds.length === 0) return;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;
  await db
    .insert(dealOwners)
    .values(dealIds.map((dealId) => ({ dealId, userId })))
    .onConflictDoNothing();
  await db.insert(activities).values(
    dealIds.map((dealId) => ({
      dealId,
      userId: me.id,
      type: "owner",
      content: `La til ${user.name} som eier`,
    }))
  );
  if (userId !== me.id) {
    const dealRows = await db
      .select({ id: deals.id, companyId: deals.companyId })
      .from(deals)
      .where(inArray(deals.id, dealIds));
    await db.insert(notifications).values(
      dealRows.map((d) => ({
        userId,
        actorUserId: me.id,
        dealId: d.id,
        companyId: d.companyId,
      }))
    );
  }
  revalidateDealViews();
}

// Sletter flere deals samtidig, med samme selskaps-opprydding som deleteDeal.
export async function bulkDeleteDeals(dealIds: number[]): Promise<{ deleted: number }> {
  await requireUser();
  if (dealIds.length === 0) return { deleted: 0 };
  const rows = await db.query.deals.findMany({ where: inArray(deals.id, dealIds) });
  const companyIds = [...new Set(rows.map((d) => d.companyId))];

  await db.delete(deals).where(inArray(deals.id, dealIds));

  for (const companyId of companyIds) {
    const remaining = await db.query.deals.findFirst({ where: eq(deals.companyId, companyId) });
    if (remaining) continue;
    const hasMail = await db.query.emailMessages.findFirst({
      where: (m, { eq: eqOp }) => eqOp(m.companyId, companyId),
    });
    if (!hasMail) await db.delete(companies).where(eq(companies.id, companyId));
  }

  revalidateDealViews();
  return { deleted: rows.length };
}
