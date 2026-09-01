"use client";

import { useRef, useState, useTransition } from "react";
import { addNote } from "@/lib/actions";

// Samme prinsipp som kontakttypene i ContactLog: et notat er internt (og
// teller ikke som kontakt) med mindre man eksplisitt merker det som faktisk
// kundekontakt — det er dette som gjør at f.eks. "telefonsvar" ikke havner i
// kontakthistorikken på selskapet, mens "sendte tilbud"/"møte"/"telefon" gjør.
const KINDS = [
  { id: "", label: "Notat" },
  { id: "epost", label: "Sendt e-post" },
  { id: "moete", label: "Møte" },
  { id: "telefon", label: "Telefonsamtale" },
  { id: "tilbud", label: "Sendt tilbud" },
  { id: "annet", label: "Annen kontakt" },
];

export default function AddNoteForm({ dealId }: { dealId: number }) {
  const [kind, setKind] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(data: FormData) => {
        startTransition(async () => {
          await addNote(dealId, data);
          formRef.current?.reset();
          setKind("");
        });
      }}
      className="mb-5 flex flex-col gap-2"
    >
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap gap-1 rounded-full bg-mist/[0.05] p-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition ${
              kind === k.id ? "bg-surface text-ink shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <textarea
        name="content"
        rows={2}
        required
        placeholder="Skriv et notat …"
        className="field resize-none"
      />
      <button type="submit" disabled={pending} className="btn btn-secondary self-end">
        {pending ? "Lagrer …" : "Legg til notat"}
      </button>
    </form>
  );
}
