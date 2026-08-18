"use client";

import { useState } from "react";
import type { Stage } from "@/lib/stages";

// Egen popover for fase i bulk-verktøylinjen i stedet for en native <select>
// — nettleseren bestemmer selv retningen på en native dropdown (og fargen på
// selve listen er ikke stilbar), noe som var galt når verktøylinjen ligger
// fast nederst i vinduet. Åpner alltid oppover, som de andre bulk-velgerne.
export default function BulkStagePicker({
  stages,
  disabled,
  onApply,
}: {
  stages: Stage[];
  disabled?: boolean;
  onApply: (stageId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  function choose(stageId: string) {
    setOpen(false);
    onApply(stageId);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
      >
        Sett fase …
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full z-40 mb-1.5 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {stages.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => choose(String(s.id))}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-mist/[0.05]"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
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
