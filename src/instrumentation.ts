// Kjøres én gang når en Next-serverinstans starter.

export async function register() {
  // Kun i Node-runtimen; edge-runtimen har verken database eller filsystem.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { migrateImagesToObjectStorage } = await import("@/lib/migrateImages.server");

  // IKKE await: register() må bli ferdig før serveren tar imot forespørsler,
  // og flyttingen skal ikke forsinke oppstart. Første gang er det noen få
  // opplastinger; etterpå tre tellinger som ikke finner noe.
  //
  // Under `next build` er R2-variablene ikke satt, så dette avslutter
  // umiddelbart — bygget laster ingenting opp.
  void migrateImagesToObjectStorage()
    .then((r) => {
      if (r.moved > 0 || r.failed > 0) {
        console.log(
          `bildeflytting: ${r.moved} flyttet, ${r.skipped} hoppet over, ` +
            `${r.failed} feilet, ${Math.round(r.bytesFreed / 1024)} kB ut av databasen`
        );
      }
    })
    .catch((err) => {
      // Skal aldri velte appen — bildene virker fortsatt fra databasen,
      // siden /api/avatar har en reserveløsning for base64.
      console.error("bildeflytting feilet:", err instanceof Error ? err.message : err);
    });
}
