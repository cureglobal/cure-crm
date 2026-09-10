import { and, eq, isNull, like } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, users, companies, referenceProjects } from "@/lib/db";
import {
  putObject,
  decodeDataUrl,
  extensionFor,
  isObjectStorageEnabled,
} from "@/lib/objectStorage";

// Flytter bilder som fortsatt ligger som base64 i databasen over i R2.
//
// Kjøres automatisk ved oppstart (se src/instrumentation.ts) og kan kjøres
// manuelt med `npm run migrate:images`. Etter første gjennomkjøring er dette
// tre billige tellinger som ikke finner noe.
//
// Rekkefølgen er viktig: fila lastes opp FØR raden oppdateres. Feiler
// opplastingen, står raden urørt og kan forsøkes på nytt. Motsatt rekkefølge
// ville gitt rader som peker på filer som ikke finnes.

export interface ImageMigrationResult {
  moved: number;
  skipped: number;
  failed: number;
  bytesFreed: number;
}

async function moveOne(
  dataUrl: string,
  prefix: string
): Promise<{ key: string; url: string } | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const key = `${prefix}/${randomUUID()}.${extensionFor(decoded.contentType)}`;
  await putObject(key, decoded.body, decoded.contentType);
  return { key, url: `/api/media/${key}` };
}

export async function migrateImagesToObjectStorage(): Promise<ImageMigrationResult> {
  const result: ImageMigrationResult = { moved: 0, skipped: 0, failed: 0, bytesFreed: 0 };
  if (!isObjectStorageEnabled()) return result;

  // --- Profilbilder ---
  const userRows = await db
    .select({ id: users.id, data: users.avatarDataUrl })
    .from(users)
    .where(and(like(users.avatarDataUrl, "data:%"), isNull(users.avatarObjectKey)));

  for (const row of userRows) {
    if (!row.data) continue;
    try {
      const stored = await moveOne(row.data, `avatars/${row.id}`);
      if (!stored) {
        result.skipped++;
        continue;
      }
      // Base64-en nulles: bildet bor i R2 nå. /api/avatar slår opp nøkkelen.
      await db
        .update(users)
        .set({ avatarObjectKey: stored.key, avatarDataUrl: null })
        .where(eq(users.id, row.id));
      result.moved++;
      result.bytesFreed += row.data.length;
    } catch {
      result.failed++;
    }
  }

  // --- Firmalogoer. Kun de som faktisk er base64; vanlige favicon-URL-er
  // skal stå urørt.
  const companyRows = await db
    .select({ id: companies.id, data: companies.logoUrl })
    .from(companies)
    .where(and(like(companies.logoUrl, "data:%"), isNull(companies.logoObjectKey)));

  for (const row of companyRows) {
    if (!row.data) continue;
    try {
      const stored = await moveOne(row.data, `logos/${row.id}`);
      if (!stored) {
        result.skipped++;
        continue;
      }
      // logoUrl skal fortsatt være en URL — nå en intern /api/media-lenke.
      await db
        .update(companies)
        .set({ logoUrl: stored.url, logoObjectKey: stored.key })
        .where(eq(companies.id, row.id));
      result.moved++;
      result.bytesFreed += row.data.length;
    } catch {
      result.failed++;
    }
  }

  // --- Skjermbilder av referanseprosjekter ---
  const refRows = await db
    .select({ id: referenceProjects.id, data: referenceProjects.screenshot })
    .from(referenceProjects)
    .where(
      and(
        like(referenceProjects.screenshot, "data:%"),
        isNull(referenceProjects.screenshotObjectKey)
      )
    );

  for (const row of refRows) {
    if (!row.data) continue;
    try {
      const stored = await moveOne(row.data, "reference");
      if (!stored) {
        result.skipped++;
        continue;
      }
      await db
        .update(referenceProjects)
        .set({ screenshot: stored.url, screenshotObjectKey: stored.key })
        .where(eq(referenceProjects.id, row.id));
      result.moved++;
      result.bytesFreed += row.data.length;
    } catch {
      result.failed++;
    }
  }

  return result;
}
