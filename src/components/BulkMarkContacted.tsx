"use client";

import { useRef, useState, useTransition } from "react";
import { bulkMarkContactedByEmail, type BulkMarkContactedResult } from "@/lib/actions";
import { parseCsv, findColumn, cell } from "@/lib/csv";
import { Upload, FileSpreadsheet, X, Check } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function BulkMarkContacted() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkMarkContactedResult | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setError("Fant ingen rader i fila.");
      return;
    }
    const header = rows[0];
    const emailIdx = findColumn(header, "e-post", "epost", "email", "mail");
    if (emailIdx === -1) {
      setError("Fant ingen kolonne som ser ut som e-post i fila.");
      return;
    }
    const found = rows
      .slice(1)
      .map((r) => cell(r, emailIdx).toLowerCase())
      .filter((e) => EMAIL_RE.test(e));
    if (found.length === 0) {
      setError("Fant ingen gyldige e-postadresser i fila.");
      return;
    }
    setFileName(file.name);
    setEmails([...new Set(found)]);
  }

  function reset() {
    setFileName(null);
    setEmails([]);
    setResult(null);
    setError(null);
    setShowUnmatched(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function apply() {
    if (emails.length === 0) return;
    startTransition(async () => {
      const res = await bulkMarkContactedByEmail(emails, note);
      setResult(res);
      setFileName(null);
      setEmails([]);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-[12px] font-medium text-ink-soft">
        Merkelapp (valgfritt, vises i kontaktloggen)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="F.eks. Cure 10 / Placebo – invitasjon"
          className="field mt-1"
        />
      </label>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />

      {!fileName ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="btn btn-secondary self-start"
        >
          <Upload size={14} />
          Velg CSV-fil …
        </button>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl bg-mist/[0.03] px-4 py-3">
          <FileSpreadsheet size={16} className="shrink-0 text-ink-soft" />
          <span className="flex-1 truncate text-[13px] font-medium">{fileName}</span>
          <span className="shrink-0 text-[12.5px] text-ink-soft">
            {emails.length} e-postadresser
          </span>
          <button
            onClick={reset}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] text-danger">{error}</p>
      )}

      {emails.length > 0 && (
        <button onClick={apply} disabled={pending} className="btn btn-primary self-start">
          <Check size={14} />
          {pending
            ? "Oppdaterer …"
            : `Sett sist kontakt til i dag for ${emails.length} e-postadresser`}
        </button>
      )}

      {result && (
        <div className="rounded-xl bg-success/10 px-4 py-2.5 text-[13px] text-success-ink">
          <p className="font-medium">
            {result.matchedPeople} personer matchet → {result.matchedCompanies} selskaper fikk
            «sist kontakt» satt til i dag.
          </p>
          {result.unmatched.length > 0 && (
            <>
              <button
                onClick={() => setShowUnmatched((v) => !v)}
                className="mt-1 font-medium underline decoration-dotted"
              >
                {result.unmatched.length} e-postadresser ble ikke funnet i CRM-et
                {showUnmatched ? " (skjul)" : " (vis)"}
              </button>
              {showUnmatched && (
                <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-surface/60 p-2 font-mono text-[11.5px]">
                  {result.unmatched.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
