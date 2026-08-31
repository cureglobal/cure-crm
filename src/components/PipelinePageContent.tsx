import { desc, eq, asc, inArray } from "drizzle-orm";
import { db, deals as dealsTable, companies, users, activities } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toDateInputValue } from "@/lib/format";
import { getStages } from "@/lib/stages.server";
import { getPipelines, getDefaultPipelineId } from "@/lib/pipelines.server";
import { getBusinessUnits } from "@/lib/businessUnits.server";
import { getLostReasons } from "@/lib/lostReasons.server";
import { getDealSlugMap } from "@/lib/dealSlugs.server";
import { getTags } from "@/lib/tags.server";
import type { ResolvedFilters } from "@/lib/pipelineFilters";
import PipelineView from "@/components/PipelineView";
import type { DealRow } from "@/components/DealsTable";

// Delt mellom /leads (tolker filtre fra URL-en) og /leads/visning/[slug]
// (tolker filtre fra en lagret visning, med URL-parametre som overstyring)
// — selve datahentingen og rendringen er identisk uansett hvor filtrene kom
// fra, se ResolvedFilters i pipelineFilters.ts.
export default async function PipelinePageContent({
  filters,
  savedViewName,
}: {
  filters: ResolvedFilters;
  savedViewName?: string;
}) {
  const me = await requireUser();

  // Bare pipeline → pipelineId → stages er en ekte avhengighetskjede — alt
  // annet under er uavhengig og hentes parallelt i stedet for i serie
  // (produksjon går mot en ekstern Turso-database, så hvert await er en
  // ekte nettverkstur; 12 sekvensielle spørringer på appens mest besøkte
  // side var en stor del av at alt føltes tregt).
  const pipelines = await getPipelines();
  const pipelineId =
    filters.pipelineId != null && pipelines.some((p) => p.id === filters.pipelineId)
      ? filters.pipelineId
      : await getDefaultPipelineId();

  const [
    rows,
    allUsers,
    coOwnerRows,
    dealTagOptions,
    dealTagRows,
    companyOptionsRaw,
    dealLineRows,
    commentActivity,
    stages,
    businessUnits,
    lostReasons,
    slugMap,
  ] = await Promise.all([
    db
      .select({
        id: dealsTable.id,
        title: dealsTable.title,
        stage: dealsTable.stage,
        value: dealsTable.value,
        updatedAt: dealsTable.updatedAt,
        followUpAt: dealsTable.followUpAt,
        comment: dealsTable.comment,
        ownerId: dealsTable.ownerId,
        companyId: dealsTable.companyId,
        companyName: companies.name,
        logoUrl: companies.logoUrl,
        companyBusinessUnitId: companies.businessUnitId,
      })
      .from(dealsTable)
      .innerJoin(companies, eq(dealsTable.companyId, companies.id))
      .orderBy(desc(dealsTable.updatedAt)),
    db.query.users.findMany({ orderBy: [asc(users.name)] }),
    db.query.dealOwners.findMany(),
    getTags("deal"),
    db.query.dealTags.findMany(),
    db.query.companies.findMany({ orderBy: [asc(companies.name)] }),
    db.query.dealLines.findMany(),
    // Hvem som sist rørte kommentarfeltet — "comment" er vanlig redigering,
    // "lost" fordi tapt-flyten også kan legge til tekst i kommentaren.
    // Mangler helt for CSV-importerte deals, som ikke logger en aktivitet.
    db
      .select({ dealId: activities.dealId, userId: activities.userId, createdAt: activities.createdAt })
      .from(activities)
      .where(inArray(activities.type, ["comment", "lost"]))
      .orderBy(desc(activities.createdAt)),
    getStages(pipelineId),
    getBusinessUnits(),
    getLostReasons(),
    getDealSlugMap(),
  ]);

  const ownerNames = new Map(allUsers.map((u) => [u.id, u.name]));
  const ownerAvatars = new Map(allUsers.map((u) => [u.id, u.avatarDataUrl]));

  const coOwnerIdsByDeal = new Map<number, number[]>();
  for (const r of coOwnerRows) {
    const list = coOwnerIdsByDeal.get(r.dealId) ?? [];
    list.push(r.userId);
    coOwnerIdsByDeal.set(r.dealId, list);
  }

  const tagIdsByDeal = new Map<number, number[]>();
  for (const r of dealTagRows) {
    const list = tagIdsByDeal.get(r.dealId) ?? [];
    list.push(r.tagId);
    tagIdsByDeal.set(r.dealId, list);
  }

  const companyOptions = companyOptionsRaw.map((c) => ({
    id: c.id,
    name: c.name,
    logoUrl: c.logoUrl,
  }));

  const lineDealIds = new Set(dealLineRows.map((l) => l.dealId));

  const commentActivityByDeal = new Map<number, { userId: number | null; createdAt: Date }>();
  for (const a of commentActivity) {
    if (!commentActivityByDeal.has(a.dealId)) {
      commentActivityByDeal.set(a.dealId, { userId: a.userId, createdAt: a.createdAt });
    }
  }
  function commentAuthor(dealId: number): string | null {
    const uid = commentActivityByDeal.get(dealId)?.userId;
    return uid != null ? (ownerNames.get(uid) ?? null) : null;
  }
  function commentedAt(dealId: number): number | null {
    return commentActivityByDeal.get(dealId)?.createdAt.getTime() ?? null;
  }

  const pipelineStageIds = new Set(stages.map((s) => String(s.id)));
  const stageOrder = new Map(stages.map((s, i) => [String(s.id), i]));
  const dealRows: DealRow[] = rows
    .filter((d) => pipelineStageIds.has(d.stage))
    .sort((a, b) => (stageOrder.get(a.stage) ?? 99) - (stageOrder.get(b.stage) ?? 99))
    .map((d) => ({
      id: d.id,
      slug: slugMap.get(d.id) ?? String(d.id),
      companyName: d.companyName,
      logoUrl: d.logoUrl,
      companyBusinessUnitId: d.companyBusinessUnitId,
      ownerId: d.ownerId,
      ownerName: d.ownerId == null ? "" : (ownerNames.get(d.ownerId) ?? ""),
      ownerAvatarUrl: d.ownerId == null ? null : (ownerAvatars.get(d.ownerId) ?? null),
      coOwnerIds: coOwnerIdsByDeal.get(d.id) ?? [],
      title: d.title,
      stage: d.stage,
      value: d.value,
      hasLines: lineDealIds.has(d.id),
      updatedAt: d.updatedAt.getTime(),
      followUpAt: d.followUpAt ? d.followUpAt.getTime() : null,
      followUpInput: toDateInputValue(d.followUpAt),
      comment: d.comment ?? "",
      commentedBy: d.comment ? commentAuthor(d.id) : null,
      commentedAt: d.comment ? commentedAt(d.id) : null,
      tagIds: tagIdsByDeal.get(d.id) ?? [],
    }));

  return (
    <PipelineView
      rows={dealRows}
      stages={stages}
      owners={allUsers.map((u) => ({ id: u.id, name: u.name, avatarDataUrl: u.avatarDataUrl }))}
      businessUnits={businessUnits.map((b) => ({ id: b.id, name: b.name }))}
      lostReasons={lostReasons.map((r) => ({ id: r.id, label: r.label }))}
      currentUserId={me.id}
      companyOptions={companyOptions}
      savedViewName={savedViewName}
      pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
      pipelineId={pipelineId}
      tags={dealTagOptions.map((t) => ({ id: t.id, label: t.label }))}
      initialView={filters.view}
      initialSearch={filters.search}
      initialDatePreset={filters.datePreset}
      initialFromDate={filters.fromDate}
      initialToDate={filters.toDate}
      initialOwnerId={filters.ownerId}
      initialBusinessUnitId={filters.businessUnitId}
      initialTagId={filters.tagId}
      initialActiveDays={filters.activeDays}
      initialGroupByStage={filters.groupByStage}
    />
  );
}
