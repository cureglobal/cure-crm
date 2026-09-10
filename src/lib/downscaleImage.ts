// Bilder som lastes opp i appen (profilbilder, firmalogoer) lagres som
// base64 data-URL i databasen. Det som lastes opp blir derfor liggende i
// full størrelse for alltid, og følger med i svaret hver gang raden hentes.
// Ett ukomprimert bilde på 1 MB ble til 1,4 MB base64 i hver eneste
// sidelasting. Derfor skaleres alt ned i nettleseren FØR det sendes.

export interface DownscaleOptions {
  // Lengste side i piksler etter nedskalering.
  maxDimension: number;
  // "jpeg" er minst, men har ingen gjennomsiktighet og legges på hvit bunn.
  // "png" beholder gjennomsiktighet — bruk den for logoer, som ofte ligger
  // rett på et kort uten egen bakgrunn.
  format: "jpeg" | "png";
  // Kun for jpeg. 0–1.
  quality?: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Faller tilbake til originalfilen hvis canvas ikke er tilgjengelig eller
// bildet ikke lar seg dekode — et for stort bilde er bedre enn ingen bilde.
export async function downscaleToDataUrl(
  file: File,
  { maxDimension, format, quality = 0.85 }: DownscaleOptions
): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    // Skalerer aldri opp — et lite bilde skal forbli lite.
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return readFileAsDataUrl(file);

    if (format === "jpeg") {
      // Uten hvit bunn blir gjennomsiktige PNG-er svarte i JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return format === "jpeg"
      ? canvas.toDataURL("image/jpeg", quality)
      : canvas.toDataURL("image/png");
  } catch {
    return readFileAsDataUrl(file);
  }
}
