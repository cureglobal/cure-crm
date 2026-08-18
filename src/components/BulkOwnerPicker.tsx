"use client";

import { useState } from "react";
import { Check, Star } from "lucide-react";
import Avatar from "@/components/Avatar";

// Slår sammen de to gamle "Sett eier"/"Legg til eier"-dropdownene til én
// popover der man kan velge flere eiere samtidig — samme mønster som
// eier-velgeren for én enkelt deal (DealOwnerCell): huk av for å legge til
// som med-eier, stjerne for å gjøre til hovedeier. Endringene er kun lokale
// til man lukker popover-en (klikk utenfor), da sendes de til serveren.
export default function BulkOwnerPicker({
  owners,
  disabled,
  onApply,
}: {
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
  disabled?: boolean;
  onApply: (mainOwnerId: number | null, addOwnerIds: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mainId, setMainId] = useState<number | null>(null);
  const [addIds, setAddIds] = useState<number[]>([]);

  function openPopover() {
    setMainId(null);
    setAddIds([]);
    setOpen(true);
  }

  function closePopover() {
    setOpen(false);
    if (mainId != null || addIds.length > 0) onApply(mainId, addIds);
  }

  function toggleAdd(userId: number) {
    if (userId === mainId) {
      setMainId(null);
      return;
    }
    setAddIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function toggleMain(userId: number) {
    setMainId((prev) => (prev === userId ? null : userId));
    setAddIds((prev) => prev.filter((id) => id !== userId));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? closePopover() : openPopover())}
        disabled={disabled}
        className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
      >
        Sett eier …
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={closePopover} />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              Eiere
            </p>
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {owners.map((o) => {
                const isMain = o.id === mainId;
                const isAdd = addIds.includes(o.id);
                const checked = isMain || isAdd;
                return (
                  <li
                    key={o.id}
                    className="group flex items-center gap-1 rounded-lg hover:bg-mist/[0.05]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleAdd(o.id)}
                      className="flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12.5px] transition"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? "border-accent bg-accent text-accent-ink" : "border-line"
                        }`}
                      >
                        {checked && <Check size={11} strokeWidth={3} />}
                      </span>
                      <Avatar name={o.name} imageUrl={o.avatarDataUrl} size={18} />
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      {isMain && (
                        <span className="shrink-0 text-[10.5px] text-ink-faint">Hovedeier</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMain(o.id)}
                      title="Gjør til hovedeier"
                      className={`mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${
                        isMain
                          ? "text-accent"
                          : "text-ink-faint opacity-0 hover:bg-mist/[0.08] hover:text-accent group-hover:opacity-100"
                      }`}
                    >
                      <Star size={12} fill={isMain ? "currentColor" : "none"} />
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
