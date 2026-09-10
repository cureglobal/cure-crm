import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, users } from "@/lib/db";
import { getObject, decodeDataUrl } from "@/lib/objectStorage";

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

export async function GET(_request: Request, ctx: RouteContext<"/api/avatar/[id]">) {
  // Innlogging kreves, men uten omdirigering: en <img> som får en
  // innloggingsside i retur viser bare et ødelagt bilde uansett.
  const me = await getCurrentUser();
  if (!me) return new Response(null, { status: 401 });

  const userId = Number((await ctx.params).id);
  if (!Number.isInteger(userId)) return new Response(null, { status: 404 });

  const row = await db
    .select({ objectKey: users.avatarObjectKey, avatarDataUrl: users.avatarDataUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row[0]) return new Response(null, { status: 404 });

  // Normalveien: bildet ligger i R2.
  if (row[0].objectKey) {
    const object = await getObject(row[0].objectKey);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": object.contentType,
        "Content-Length": String(object.body.byteLength),
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }

  // Reserveløsning for rader som ennå ikke er flyttet ut av databasen (se
  // scripts/migrate-images.ts). Kan fjernes når alle rader har en nøkkel.
  const dataUrl = row[0].avatarDataUrl;
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
