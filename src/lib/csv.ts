// Enkel CSV-parser med støtte for anførselstegn, escapede anførselstegn og
// linjeskift inne i felter. Skiller på komma eller semikolon (Excel i Norge
// bruker ofte semikolon).
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, ""); // fjern BOM fra Excel
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? undefined : clean.indexOf("\n"));
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// Finner kolonneindeks ut fra flere mulige overskrifter (norsk og engelsk).
export function findColumn(header: string[], ...aliases: string[]): number {
  const normalized = header.map((h) => h.trim().toLowerCase().replace(/\./g, ""));
  for (const alias of aliases) {
    const target = alias.toLowerCase().replace(/\./g, "");
    const exact = normalized.indexOf(target);
    if (exact !== -1) return exact;
  }
  for (const alias of aliases) {
    const target = alias.toLowerCase().replace(/\./g, "");
    const partial = normalized.findIndex((h) => h.includes(target));
    if (partial !== -1) return partial;
  }
  return -1;
}

export function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

// Tall fra CSV kan komme som «1 234,50», «1234.5» eller «kr 1 234».
export function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  // Komma som desimalskilletegn når det ikke også finnes punktum.
  const normalized = cleaned.includes(",") && !cleaned.includes(".")
    ? cleaned.replace(",", ".")
    : cleaned.replace(/,/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // dd.mm.yyyy eller dd/mm/yyyy
  const nordic = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (nordic) {
    const [, d, m, y] = nordic;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}
