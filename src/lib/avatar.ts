// Profilbilder ligger som data-URL i users.avatar_data_url, opptil ~1 MB
// base64 per bruker. Å hente den kolonnen i en listespørring betyr at hele
// base64-strengen følger med i svaret til nettleseren ved HVER sidelasting
// — 7 bilder var 3,8 MB av en database på 4,9 MB, og det alene gjorde appen
// treg. I stedet peker sidene på /api/avatar/[id], som serverer bildet med
// cache som varer for alltid.
//
// Spørringer skal derfor velge avatarUpdatedAt (et tall), aldri
// avatarDataUrl, og sende resultatet av denne funksjonen videre.
export function avatarUrlFor(
  // Kan være null når raden kom fra en leftJoin uten eier.
  userId: number | null | undefined,
  avatarUpdatedAt: Date | number | null | undefined
): string | null {
  if (userId == null || avatarUpdatedAt == null) return null;
  // Tidsstempelet gjør URL-en ny når bildet byttes. Uten det ville
  // nettleseren beholdt det gamle bildet i opptil et år.
  const version =
    avatarUpdatedAt instanceof Date ? avatarUpdatedAt.getTime() : avatarUpdatedAt;
  return `/api/avatar/${userId}?v=${version}`;
}
