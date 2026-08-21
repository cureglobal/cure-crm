"use client";

import { useState } from "react";
import { Check, Tag as TagIcon } from "lucide-react";

// Legger til (aldri fjerner) én eller flere tagger på alle valgte rader —
// brukt fra bulk-verktøylinjen i Pipeline- og Personer-listene. Starter
// alltid tomt siden en heterogen seleksjon ikke har noen meningsfull
// "gjeldende" tagg-tilstand å vise.
export default function BulkTagPicker({
  tags,
  disabled,
  onApply,
}: {
  tags: { id: number; label: string }[];
  disabled?: boolean;
  onApply: (tagIds: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<number[]>([]);

  function toggle(id: number) {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function close() {
    setOpen(false);
    if (checked.length > 0) onApply(checked);
    setChecked([]);
  }

  if (tags.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
      >
        <TagIcon size={13} />
        Tagg …
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={close} />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              Legg til tagger
            </p>
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {tags.map((t) => {
                const isChecked = checked.includes(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => toggle(t.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-mist/[0.05]"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isChecked ? "border-accent bg-accent text-accent-ink" : "border-line"
                        }`}
                      >
                        {isChecked && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
