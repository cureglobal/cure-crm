"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { Stage } from "@/lib/stages";

// Egen popover for fase i bulk-verktøylinjen i stedet for en native <select>
// — nettleseren bestemmer selv retningen på en native dropdown (og fargen på
// selve listen er ikke stilbar), noe som var galt når verktøylinjen ligger
// fast nederst i vinduet. Åpner alltid oppover, som de andre bulk-velgerne.
export default function BulkStagePicker({
  stages,
  disabled,
  onApply,
  currentStageId,
}: {
  stages: Stage[];
  disabled?: boolean;
  onApply: (stageId: string) => void;
  currentStageId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = stages.filter((s) =>
    s.label.toLowerCase().includes(search.trim().toLowerCase())
  );

  function openPopover() {
    setSearch("");
    setOpen(true);
  }

  function choose(stageId: string) {
    setOpen(false);
    setSearch("");
    onApply(stageId);
  }

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && filtered.length === 1) {
      e.preventDefault();
      choose(String(filtered[0].id));
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        disabled={disabled}
        className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
      >
        Sett fase …
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full z-40 mb-1.5 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Søk fase …"
              className="field mb-1.5 !py-1.5 text-[12.5px]"
            />
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {filtered.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] text-ink-faint">Ingen treff.</li>
              )}
              {filtered.map((s) => {
                const isCurrent = currentStageId === String(s.id);
                return (
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
                      {isCurrent && (
                        <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-ink-faint">
                          <Check size={11} strokeWidth={2.5} />
                          Nåværende
                        </span>
                      )}
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
