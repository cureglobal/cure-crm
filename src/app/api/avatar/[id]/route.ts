import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, users } from "@/lib/db";

// Serverer profilbildet som en vanlig bildeforespørsel i stedet for at hver
// sidelasting drar med seg base64-strengen. Dette er det ENESTE stedet som
// skal lese users.avatar_data_url — se kommentaren i schema.ts.
//
// Nettleseren henter bildet én gang og gjenbruker det fra cache; URL-en
// inneholder tidsstempelet fra avatarUpdatedAt, så et nytt bilde gir en ny
// URL og dermed et nytt hent.

// Bildene er brukernes egne profilbilder og skal ikke ligge åpent, så svaret
// merkes "private": kun nettleseren til den innloggede brukeren cacher det,
// ikke mellomliggende cacher hos Railway eller andre.
const CACHE_CONTROL = "private, max-age=31536000, immutable";

function decodeDataUrl(dataUrl: string): { body: ArrayBuffer; contentType: string } | null {
  // Formatet er "data:<mime>;base64,<payload>". Alt annet (f.eks. en gammel
  // rad med en ekstern http-URL) hører ikke hjemme her. [\s\S] i stedet for
  // .-med-s-flagget, som krever et nyere mål enn tsconfig er satt til.
  const match = /^data:([\w.+/-]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const buf = Buffer.from(match[2], "base64");
    // Buffer deler minne med en større pool, så det må skjæres ut en egen
    // ArrayBuffer — ellers sendes naboens bytes med i svaret.
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { contentType: match[1], body };
  } catch {
    return null;
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/api/avatar/[id]">) {
  // Innlogging kreves, men uten omdirigering: en <img> som får en
  // innloggingsside i retur viser bare et ødelagt bilde uansett.
  const me = await getCurrentUser();
  if (!me) return new Response(null, { status: 401 });

  const userId = Number((await ctx.params).id);
  if (!Number.isInteger(userId)) return new Response(null, { status: 404 });

  const row = await db
    .select({ avatarDataUrl: users.avatarDataUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const dataUrl = row[0]?.avatarDataUrl;
  if (!dataUrl) return new Response(null, { status: 404 });

  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return new Response(null, { status: 404 });

  return new Response(decoded.body, {
    headers: {
      "Content-Type": decoded.contentType,
      "Content-Length": String(decoded.body.byteLength),
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
