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
  currentOwnerId,
}: {
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
  disabled?: boolean;
  onApply: (mainOwnerId: number | null, addOwnerIds: number[]) => void;
  currentOwnerId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [mainId, setMainId] = useState<number | null>(null);
  const [addIds, setAddIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");

  const filtered = owners.filter((o) =>
    o.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  function openPopover() {
    setMainId(null);
    setAddIds([]);
    setSearch("");
    setOpen(true);
  }

  function closePopover() {
    setOpen(false);
    if (mainId != null || addIds.length > 0) onApply(mainId, addIds);
  }

  function chooseMain(userId: number) {
    setOpen(false);
    setSearch("");
    onApply(userId, []);
  }

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && filtered.length === 1) {
      e.preventDefault();
      chooseMain(filtered[0].id);
    }
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
          <div className="absolute left-0 bottom-full z-40 mb-1.5 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Søk eier …"
              className="field mb-1.5 !py-1.5 text-[12.5px]"
            />
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {filtered.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] text-ink-faint">Ingen treff.</li>
              )}
              {filtered.map((o) => {
                const isMain = o.id === mainId;
                const isAdd = addIds.includes(o.id);
                const checked = isMain || isAdd;
                const isCurrent = !isMain && o.id === currentOwnerId;
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
                      {isCurrent && (
                        <span className="shrink-0 text-[10.5px] text-ink-faint">Nåværende</span>
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
