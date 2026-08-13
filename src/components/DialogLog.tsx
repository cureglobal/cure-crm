"use client";

import { useRef, useState, useTransition } from "react";
import { deleteContactEvent, logContact } from "@/lib/actions";
import { formatDate, toDateInputValue } from "@/lib/format";
import { Plus, Trash2, Users, Phone, Mail, Send } from "lucide-react";

export interface DialogLogItem {
  id: number;
  kind: string;
  note: string | null;
  occurredAt: number;
  userName: string | null;
}

const MANUAL_KINDS = [
  { id: "moete", label: "Møte", icon: <Users size={13} /> },
  { id: "epost", label: "Mail", icon: <Mail size={13} /> },
  { id: "telefon", label: "Telefon", icon: <Phone size={13} /> },
];

// Inkluderer riktig preposisjon per type — "snakket med"/"hatt møte med" tar
// "med", ikke "til" (i motsetning til "sendt tilbud/mail til"), så disse kan
// ikke deles inn i et felles "{verb} til {kunde}"-mønster uten å bli feil norsk.
function phraseFor(kind: string) {
  switch (kind) {
    case "tilbud":
      return "sendt tilbud til";
    case "moete":
      return "hatt møte med";
    case "epost":
      return "sendt mail til";
    case "telefon":
      return "snakket med";
    default:
      return "hatt kontakt med";
  }
}

function iconFor(kind: string) {
  if (kind === "tilbud") return <Send size={13} />;
  return MANUAL_KINDS.find((k) => k.id === kind)?.icon ?? <Users size={13} />;
}

export default function DialogLog({
  companyId,
  companyName,
  items,
}: {
  companyId: number;
  companyName: string;
  items: DialogLogItem[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("moete");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Dialog med {companyName}</h2>
        <button onClick={() => setOpen((v) => !v)} className="btn btn-ghost shrink-0">
          <Plus size={14} />
          Logg kontakt
        </button>
      </div>

      {open && (
        <form
          ref={formRef}
          action={(data: FormData) => {
            startTransition(async () => {
              await logContact(companyId, data);
              formRef.current?.reset();
              setOpen(false);
            });
          }}
          className="mb-4 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-4"
        >
          <input type="hidden" name="kind" value={kind} />
          <div className="flex gap-1 rounded-full bg-white p-1">
            {MANUAL_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-medium transition ${
                  kind === k.id ? "bg-accent-soft text-accent" : "text-ink-soft hover:text-ink"
                }`}
              >
                {k.icon}
                {k.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[150px_1fr] gap-2">
            <input
              type="date"
              name="occurredAt"
              defaultValue={toDateInputValue(new Date())}
              className="field"
            />
            <input name="note" placeholder="Kort notat (valgfritt)" className="field" />
          </div>
          <button type="submit" disabled={pending} className="btn btn-primary self-start">
            {pending ? "Lagrer …" : "Lagre kontakt"}
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <p className="py-2 text-[13px] text-ink-faint">Ingen kontakt logget ennå.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={item.id} className="group flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-ink-soft">
                {iconFor(item.kind)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  <span className="font-medium">{item.userName ?? "Ukjent"}</span> har{" "}
                  {phraseFor(item.kind)} <span className="font-medium">{companyName}</span>
                  <span className="text-ink-soft"> · {formatDate(new Date(item.occurredAt))}</span>
                </p>
                {item.note && (
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">{item.note}</p>
                )}
              </div>
              <form action={deleteContactEvent.bind(null, item.id, companyId)}>
                <button
                  type="submit"
                  title="Fjern"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
