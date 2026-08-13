"use client";

import { useMemo, useState, useTransition } from "react";
import { sendQuoteEmail } from "@/lib/actions";
import { Send, X } from "lucide-react";

export interface QuoteContact {
  id: number;
  name: string;
  email: string;
}

export default function SendQuoteButton({
  dealId,
  dealTitle,
  contacts,
}: {
  dealId: number;
  dealTitle: string;
  contacts: QuoteContact[];
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(contacts.map((c) => c.id)));
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [extraInput, setExtraInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const recipients = useMemo(() => {
    const fromContacts = contacts.filter((c) => checked.has(c.id)).map((c) => c.email);
    return [...new Set([...fromContacts, ...extraEmails])];
  }, [contacts, checked, extraEmails]);

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addExtra() {
    const email = extraInput.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    if (!extraEmails.includes(email)) setExtraEmails((prev) => [...prev, email]);
    setExtraInput("");
  }

  function removeExtra(email: string) {
    setExtraEmails((prev) => prev.filter((e) => e !== email));
  }

  function send() {
    startTransition(async () => {
      const res = await sendQuoteEmail(dealId, recipients);
      setResult({ ok: res.ok, text: res.message });
      if (res.ok) setOpen(false);
    });
  }

  function reset() {
    setOpen(false);
    setResult(null);
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline"
      >
        <Send size={13} />
        Send til kunde
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-mist/[0.02] p-4">
      <p className="mb-3 text-[13px] font-medium">
        Send pristilbud for «{dealTitle}»
      </p>

      {contacts.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-1.5">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`quote-contact-${c.id}`}
                checked={checked.has(c.id)}
                onChange={() => toggle(c.id)}
                className="h-3.5 w-3.5"
              />
              <label htmlFor={`quote-contact-${c.id}`} className="text-[13px]">
                {c.name} <span className="text-ink-faint">· {c.email}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-[12.5px] text-ink-faint">
          Ingen kontakter med e-post registrert — legg til en e-postadresse under.
        </p>
      )}

      {extraEmails.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {extraEmails.map((e) => (
            <span
              key={e}
              className="flex items-center gap-1 rounded-full bg-mist/[0.05] px-2.5 py-1 text-[12px] text-ink-soft"
            >
              {e}
              <button onClick={() => removeExtra(e)} className="text-ink-faint hover:text-ink">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <input
          value={extraInput}
          onChange={(e) => setExtraInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addExtra();
            }
          }}
          type="email"
          placeholder="Legg til en annen e-post …"
          className="field !py-1.5 text-[13px]"
        />
        <button type="button" onClick={addExtra} className="btn btn-secondary !py-1.5 shrink-0">
          Legg til
        </button>
      </div>

      {result && !result.ok && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
          {result.text}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={send}
          disabled={pending || recipients.length === 0}
          className="btn btn-primary"
        >
          {pending
            ? "Sender …"
            : `Send til ${recipients.length || 0} mottaker${recipients.length === 1 ? "" : "e"}`}
        </button>
        <button type="button" onClick={reset} className="btn btn-secondary">
          Avbryt
        </button>
      </div>
    </div>
  );
}
