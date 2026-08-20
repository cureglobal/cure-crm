// Norske bokstaver har ingen NFKD-dekomponering (æ/ø har ingen kombinerende
// diakritisk å fjerne), så de må translittereres eksplisitt før resten av
// tegnene normaliseres bort. Delt mellom deal-slugs og lagrede visninger.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
