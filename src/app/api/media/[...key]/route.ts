import { getCurrentUser } from "@/lib/auth";
import { getObject } from "@/lib/objectStorage";

// Serverer opplastede bilder fra R2. Filene er interne (profilbilder,
// firmalogoer, skjermbilder av referanseprosjekter), så innlogging kreves —
// men ikke mer enn det: alle i selskapet ser de samme logoene uansett.
//
// Nøklene inneholder et tilfeldig ledd, så de kan ikke gjettes eller telles
// opp selv om noen skulle få tak i én av dem.

// Filene er uforanderlige: bytter man bilde, får det en ny nøkkel. Da kan
// nettleseren beholde dem så lenge den vil. "private" fordi de ikke skal
// mellomlagres av delte cacher underveis.
const CACHE_CONTROL = "private, max-age=31536000, immutable";

export async function GET(_request: Request, ctx: RouteContext<"/api/media/[...key]">) {
  const me = await getCurrentUser();
  // Ingen omdirigering: en <img> som får innloggingssiden i retur viser
  // uansett bare et ødelagt bilde.
  if (!me) return new Response(null, { status: 401 });

  const segments = (await ctx.params).key;
  // ".." kan ikke forekomme i nøkler vi selv lager, og skal aldri slippe
  // gjennom til lagringen.
  if (segments.some((s) => s === "." || s === ".." || s === "")) {
    return new Response(null, { status: 400 });
  }

  const object = await getObject(segments.join("/"));
  if (!object) return new Response(null, { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": object.contentType,
      "Content-Length": String(object.body.byteLength),
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
