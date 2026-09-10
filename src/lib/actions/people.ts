"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  db,
  deals,
  companyPeople,
  activities,
  contactEvents } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  linkPersonByEmail,
  revalidateDealViews } from "./_shared";

// ---------- Personer ----------


export async function addPersonToCompany(
  companyId: number,
  dealId: number | null,
  formData: FormData
) {
  const me = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "").trim() || null;
  if (!name) return;

  await linkPersonByEmail(companyId, email, name, phone, role);

  if (dealId) {
    await db.insert(activities).values({
      dealId,
      userId: me.id,
      type: "contact",
      content: `La til kontakt ${name}`,
    });
  }
  revalidateDealViews(dealId ?? undefined);
}

// Knytter en eksisterende person til et selskap til (person i flere selskap).
export async function linkPersonToCompany(personId: number, formData: FormData) {
  await requireUser();
  const companyId = Number(formData.get("companyId"));
  const role = String(formData.get("role") ?? "").trim() || null;
  if (!Number.isFinite(companyId)) return;
  await db
    .insert(companyPeople)
    .values({ companyId, personId, role })
    .onConflictDoNothing();
  revalidateDealViews();
  revalidatePath(`/people/${personId}`);
}

// Endrer tittel/rolle på en allerede eksisterende selskapstilknytning —
// "Rolle"-feltet i linkPersonToCompany over settes bare ved selve
// tilknytningen, og hadde ingen vei tilbake for å rette den i etterkant.
export async function updatePersonCompanyRole(
  personId: number,
  companyId: number,
  formData: FormData
) {
  await requireUser();
  const role = String(formData.get("role") ?? "").trim() || null;
  await db
    .update(companyPeople)
    .set({ role })
    .where(and(eq(companyPeople.personId, personId), eq(companyPeople.companyId, companyId)));
  revalidateDealViews();
  revalidatePath(`/people/${personId}`);
}

export async function unlinkPersonFromCompany(
  personId: number,
  companyId: number,
  dealId?: number
) {
  await requireUser();
  await db
    .delete(companyPeople)
    .where(and(eq(companyPeople.personId, personId), eq(companyPeople.companyId, companyId)));
  revalidateDealViews(dealId);
  revalidatePath(`/people/${personId}`);
}


// ---------- Notater ----------

// Kort verb per kontakttype — brukt til å generere kontakthistorikk-
// setningen automatisk når et notat markeres som faktisk kundekontakt (i
// motsetning til et internt notat, f.eks. "telefonsvar", som ikke skal telle
// som kontakt og derfor ikke har noe treff her).
const NOTE_CONTACT_VERBS: Record<string, string> = {
  epost: "sendte e-post om",
  moete: "hadde møte om",
  telefon: "snakket med kunden om",
  tilbud: "sendte tilbud på",
  annet: "hadde kontakt om",
};

export async function addNote(dealId: number, formData: FormData) {
  const me = await requireUser();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  await db.insert(activities).values({ dealId, userId: me.id, type: "note", content });

  const kind = String(formData.get("kind") ?? "").trim();
  const verb = NOTE_CONTACT_VERBS[kind];
  if (verb) {
    const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
    if (deal) {
      await db.insert(contactEvents).values({
        companyId: deal.companyId,
        userId: me.id,
        kind,
        note: `${me.name} ${verb} deal «${deal.title}».`,
        occurredAt: new Date(),
      });
    }
  }
  revalidateDealViews(dealId);
}
