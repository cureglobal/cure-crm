"use server";

import { desc, eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  savedViews } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { slugify } from "@/lib/slugify";

// ---------- Lagrede visninger (Pipeline) ----------
// Navngitte, delbare filterkombinasjoner — delt/team-synlig, ingen
// per-bruker-privatliste. Se PipelineView.tsx for hvordan feltene brukes.

export interface SavedViewFilters {
  view: string | null;
  search: string | null;
  pipelineId: number | null;
  ownerId: number | null;
  businessUnitId: number | null;
  tagId: number | null;
  datePreset: string | null;
  fromDate: string | null;
  toDate: string | null;
  activeDays: number | null;
  groupByStage: boolean | null;
}

export interface SavedViewRow extends SavedViewFilters {
  id: number;
  slug: string;
  name: string;
  createdByName: string | null;
}

export async function createSavedView(
  name: string,
  filters: SavedViewFilters
): Promise<{ ok: boolean; message: string; slug?: string }> {
  const me = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Gi visningen et navn." };

  const base = slugify(trimmed) || "visning";
  const existingSlugs = new Set((await db.query.savedViews.findMany()).map((v) => v.slug));
  let slug = base;
  let n = 2;
  while (existingSlugs.has(slug)) {
    slug = `${base}-${n}`;
    n++;
  }

  await db.insert(savedViews).values({
    slug,
    name: trimmed,
    createdByUserId: me.id,
    ...filters,
  });

  return { ok: true, message: "Visning lagret.", slug };
}

export async function listSavedViews(): Promise<SavedViewRow[]> {
  await requireUser();
  const rows = await db.query.savedViews.findMany({ orderBy: [desc(savedViews.createdAt)] });
  const userIds = [
    ...new Set(rows.map((r) => r.createdByUserId).filter((id): id is number => id != null)),
  ];
  const userRows = userIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, userIds) })
    : [];
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    createdByName: r.createdByUserId != null ? (nameById.get(r.createdByUserId) ?? null) : null,
    view: r.view,
    search: r.search,
    pipelineId: r.pipelineId,
    ownerId: r.ownerId,
    businessUnitId: r.businessUnitId,
    tagId: r.tagId,
    datePreset: r.datePreset,
    fromDate: r.fromDate,
    toDate: r.toDate,
    activeDays: r.activeDays,
    groupByStage: r.groupByStage,
  }));
}

export async function deleteSavedView(id: number): Promise<void> {
  await requireUser();
  await db.delete(savedViews).where(eq(savedViews.id, id));
}
