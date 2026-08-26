const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function formatDate(d: Date | null | undefined) {
  if (!d) return "";
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
}

// dd.mm.åååå — trygt i filnavn (ingen skråstreker/kolon), brukt for PDF-vedlegg og e-post.
export function formatDateShort(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatDateTime(d: Date | null | undefined) {
  if (!d) return "";
  return d.toLocaleString("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeDay(d: Date): { label: string; tone: "overdue" | "today" | "soon" | "later" } {
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const diff = Math.round((target.getTime() - today.getTime()) / DAY);
  if (diff < 0) return { label: diff === -1 ? "I går" : `${-diff} dager siden`, tone: "overdue" };
  if (diff === 0) return { label: "I dag", tone: "today" };
  if (diff === 1) return { label: "I morgen", tone: "soon" };
  if (diff <= 7) return { label: d.toLocaleDateString("nb-NO", { weekday: "long" }), tone: "soon" };
  return { label: formatDate(d), tone: "later" };
}

// Alltid "XXX XXXkr" (uten mellomrom før "kr") — Intl sin egen currency-stil
// legger inn et mellomrom der, som gjorde formatet ulikt formatNumberInput.
export function formatMoney(value: number | null | undefined) {
  if (value == null) return "";
  return `${new Intl.NumberFormat("nb-NO").format(value)}kr`;
}

// Samme tallgruppering som formatMoney (f.eks. "30 000 000"), men uten
// valutategn — til manuelt redigerbare beløps-input, som ellers viste rå
// sifre uten mellomrom mens den beregnede varelinje-summen viste formatMoney.
export function formatNumberInput(value: number | null | undefined) {
  if (value == null) return "";
  return new Intl.NumberFormat("nb-NO").format(value);
}

// Minutt/time-oppløst "for X siden" — til "Sist online" i Innstillinger.
// relativeDay over er dag-oppløst og passer ikke her (alt innen samme dag
// ville vist "I dag" uansett om det var for 2 minutter eller 20 timer siden).
export function relativeTimeAgo(d: Date | null | undefined): string {
  if (!d) return "Aldri";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return "Akkurat nå";
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)} min siden`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.floor(diffMs / (60 * 60_000))} t siden`;
  if (diffMs < 7 * 24 * 60 * 60_000) return `${Math.floor(diffMs / (24 * 60 * 60_000))} d siden`;
  return formatDate(d);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function toDateInputValue(d: Date | null | undefined) {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
