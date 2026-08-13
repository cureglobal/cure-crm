"use client";

import { useRef, useState, useTransition } from "react";
import { deleteContactEvent, logContact } from "@/lib/actions";
import { formatDate, toDateInputValue } from "@/lib/format";
import Avatar from "@/components/Avatar";
import { Plus, Trash2, Users, Phone, Mail, MessageSquare } from "lucide-react";

export interface ContactLogItem {
  id: number;
  kind: string;
  note: string | null;
  occurredAt: number;
  userName: string | null;
  source: "manuell" | "epost";
}

const KINDS = [
  { id: "moete", label: "Møte", icon: <Users size={13} /> },
  { id: "telefon", label: "Telefon", icon: <Phone size={13} /> },
  { id: "epost", label: "E-post", icon: <Mail size={13} /> },
  { id: "annet", label: "Annet", icon: <MessageSquare size={13} /> },
];

function kindLabel(kind: string) {
  return KINDS.find((k) => k.id === kind)?.label ?? "Kontakt";
}

function kindIcon(kind: string) {
  return KINDS.find((k) => k.id === kind)?.icon ?? <MessageSquare size={13} />;
}

export default function ContactLog({
  companyId,
  items,
}: {
  companyId: number;
  items: ContactLogItem[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("moete");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <section className="card p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Kontakthistorikk</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="btn btn-ghost shrink-0"
        >
          <Plus size={14} />
          Registrer kontakt
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
          className="mb-4 flex flex-col gap-2.5 rounded-xl bg-mist/[0.03] p-4"
        >
          <input type="hidden" name="kind" value={kind} />
          <div className="flex gap-1 rounded-full bg-surface p-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-medium transition ${
                  kind === k.id
                    ? "bg-accent-soft text-accent"
                    : "text-ink-soft hover:text-ink"
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
        <p className="py-3 text-[13px] text-ink-faint">
          Ingen kontakt registrert. Logget e-post kommer automatisk hit.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={`${item.source}-${item.id}`} className="group flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mist/[0.05] text-ink-soft">
                {kindIcon(item.kind)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  <span className="font-medium">{kindLabel(item.kind)}</span>
                  <span className="text-ink-soft"> · {formatDate(new Date(item.occurredAt))}</span>
                  {item.source === "epost" && (
                    <span className="ml-1.5 rounded-full bg-mist/[0.05] px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft">
                      automatisk
                    </span>
                  )}
                </p>
                {item.note && (
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">{item.note}</p>
                )}
              </div>
              {item.userName && <Avatar name={item.userName} size={22} />}
              {item.source === "manuell" && (
                <form action={deleteContactEvent.bind(null, item.id, companyId)}>
                  <button
                    type="submit"
                    title="Fjern"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
