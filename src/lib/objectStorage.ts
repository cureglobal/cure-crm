import { AwsClient } from "aws4fetch";

// Opplastede bilder (profilbilder, firmalogoer, skjermbilder av
// referanseprosjekter) lå tidligere som base64 data-URL rett i databasen.
// Det er feil sted: kolonnen blir med i hver SELECT som ikke eksplisitt
// utelater den, og sju profilbilder utgjorde 3,8 MB av en database på
// 4,9 MB. Filene hører hjemme i objektlagring, med bare en nøkkel i raden.
//
// Bøtta er cure-crm-media — ikke cure-crm-backup, som Litestream eier.
// Samme R2-nøkler brukes til begge (se DEPLOY.md).

const BUCKET = "cure-crm-media";

function endpoint(): string | null {
  const host = process.env.R2_ENDPOINT;
  if (!host) return null;
  // Variabelen settes uten protokoll i Railway; tåler begge deler.
  return host.startsWith("http") ? host : `https://${host}`;
}

// Null når R2 ikke er konfigurert — lokalt uten nøkler, for eksempel.
// Kallerne må håndtere det i stedet for å krasje; se isObjectStorageEnabled.
function client(): AwsClient | null {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !endpoint()) return null;
  return new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
}

export function isObjectStorageEnabled(): boolean {
  return client() !== null;
}

function objectUrl(key: string): string {
  return `${endpoint()}/${BUCKET}/${key}`;
}

export class ObjectStorageNotConfiguredError extends Error {
  constructor() {
    super("R2 er ikke konfigurert (R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ENDPOINT mangler)");
  }
}

export async function putObject(
  key: string,
  // ArrayBuffer, ikke Uint8Array: sistnevnte godtas ikke som BodyInit av
  // typene tsconfig er satt opp mot.
  body: ArrayBuffer,
  contentType: string
): Promise<void> {
  const aws = client();
  if (!aws) throw new ObjectStorageNotConfiguredError();
  const res = await aws.fetch(objectUrl(key), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      // R2 avviser PUT uten Content-Length med 411. fetch setter den ikke
      // selv for en ArrayBuffer — den bruker chunked overføring — så den må
      // settes eksplisitt. Små kropper kan tilfeldigvis gå gjennom uten;
      // ikke la det lure deg til å tro at dette er valgfritt.
      "Content-Length": String(body.byteLength),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Opplasting til R2 feilet: ${res.status} ${await res.text()}`);
  }
}

export interface StoredObject {
  body: ArrayBuffer;
  contentType: string;
}

// Null når objektet ikke finnes — en slettet eller aldri opplastet fil skal
// gi 404 i ruta over, ikke en 500.
export async function getObject(key: string): Promise<StoredObject | null> {
  const aws = client();
  if (!aws) throw new ObjectStorageNotConfiguredError();
  const res = await aws.fetch(objectUrl(key), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Henting fra R2 feilet: ${res.status}`);
  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function deleteObject(key: string): Promise<void> {
  const aws = client();
  if (!aws) throw new ObjectStorageNotConfiguredError();
  const res = await aws.fetch(objectUrl(key), { method: "DELETE" });
  // 404 er greit: målet er at objektet ikke skal finnes.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Sletting i R2 feilet: ${res.status}`);
  }
}

// Deler en data-URL i bytes og MIME-type. Brukes både av opplastingene og av
// engangsflyttingen i scripts/migrate-images.ts.
export function decodeDataUrl(
  dataUrl: string
): { body: ArrayBuffer; contentType: string } | null {
  const match = /^data:([\w.+/-]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const buf = Buffer.from(match[2], "base64");
    if (buf.length === 0) return null;
    // Buffer deler minne med en større pool, så bytene må skjæres ut i en
    // egen ArrayBuffer — ellers sendes naboens data med.
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { body, contentType: match[1] };
  } catch {
    return null;
  }
}

export function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/svg+xml") return "svg";
  return "jpg";
}
