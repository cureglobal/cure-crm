"use client";

import { useState, useTransition } from "react";
import { setUserBusinessUnit } from "@/lib/actions";
import { Landmark, Check } from "lucide-react";

// Ikon + popover i stedet for en full nedtrekksliste i raden — feltet brukes
// sjelden nok til at det ikke trenger å ta fast plass i Brukere-listen.
export default function UserBusinessUnitSelect({
  userId,
  initialBusinessUnitId,
  units,
}: {
  userId: number;
  initialBusinessUnitId: number | null;
  units: { id: number; name: string }[];
}) {
  const [value, setValue] = useState(initialBusinessUnitId);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function choose(id: number | null) {
    setValue(id);
    setOpen(false);
    startTransition(() => setUserBusinessUnit(userId, id));
  }

  const currentName = units.find((u) => u.id === value)?.name ?? "Ikke satt selskap";

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title={currentName}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-mist/[0.06] ${
          value != null ? "text-ink-soft" : "text-ink-faint"
        } hover:text-ink`}
      >
        <Landmark size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              <li>
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-mist/[0.05]"
                >
                  <span className="text-ink-faint">Ikke satt</span>
                  {value == null && <Check size={13} className="shrink-0 text-accent" />}
                </button>
              </li>
              {units.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => choose(u.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-mist/[0.05]"
                  >
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    {value === u.id && <Check size={13} className="shrink-0 text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
