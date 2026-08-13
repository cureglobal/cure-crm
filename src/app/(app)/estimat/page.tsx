import { asc, eq } from "drizzle-orm";
import { db, deals as dealsTable, companies, referenceProjects as referenceProjectsTable } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import EstimateTool from "@/components/EstimateTool";
import type { ReferenceProjectData } from "@/components/ReferenceProjects";

export default async function EstimatePage({ searchParams }: PageProps<"/estimat">) {
  await requireUser();
  const params = await searchParams;

  const dealIdParam = Number(params.dealId);
  const initialDealId = Number.isFinite(dealIdParam) && dealIdParam > 0 ? dealIdParam : null;

  let prefillUrl = "";
  let prefillDealTitle = "";
  if (initialDealId) {
    const deal = await db.query.deals.findFirst({ where: eq(dealsTable.id, initialDealId) });
    if (deal) {
      prefillDealTitle = deal.title;
      const company = await db.query.companies.findFirst({
        where: eq(companies.id, deal.companyId),
      });
      if (company?.website) prefillUrl = company.website;
    }
  }

  const dealOptions = await db
    .select({
      id: dealsTable.id,
      title: dealsTable.title,
      companyId: dealsTable.companyId,
      companyName: companies.name,
      logoUrl: companies.logoUrl,
    })
    .from(dealsTable)
    .innerJoin(companies, eq(dealsTable.companyId, companies.id))
    .orderBy(asc(companies.name));

  const referenceRows = await db.query.referenceProjects.findMany({
    orderBy: [asc(referenceProjectsTable.name)],
  });

  const referenceProjects: ReferenceProjectData[] = referenceRows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    notes: r.notes,
    screenshot: r.screenshot,
    phaseHours: r.phaseHours ? JSON.parse(r.phaseHours) : {},
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Prisverktøy</h1>
        <p className="mt-1 text-ink-soft">
          Legg inn en nettside for et automatisk startestimat, juster timer og fasene selv,
          og lagre rett på en deal.
        </p>
      </div>

      <EstimateTool
        dealOptions={dealOptions}
        initialDealId={initialDealId}
        prefillUrl={prefillUrl}
        prefillDealTitle={prefillDealTitle}
        referenceProjects={referenceProjects}
      />
    </div>
  );
}
