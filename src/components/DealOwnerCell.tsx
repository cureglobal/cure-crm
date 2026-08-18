"use client";

import { useState, useTransition } from "react";
import { addDealOwner, removeDealOwner, updateDealOwner } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { Check, Star, TriangleAlert } from "lucide-react";

export default function DealOwnerCell({
  dealId,
  ownerId,
  ownerName,
  ownerAvatarUrl,
  coOwnerIds,
  owners,
}: {
  dealId: number;
  ownerId: number | null;
  ownerName: string;
  ownerAvatarUrl: string | null;
  coOwnerIds: number[];
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Endringer gjøres kun lokalt mens popover-en er åpen, og sendes til
  // serveren først når man klikker utenfor (eller lukker på annen måte) —
  // ellers forsvinner raden momentant fra en filtrert liste (f.eks.
  // "Eier = meg") ved et feilklikk, før man rekker å ombestemme seg.
  const [pendingOwnerId, setPendingOwnerId] = useState(ownerId);
  const [pendingCoOwnerIds, setPendingCoOwnerIds] = useState<number[]>(coOwnerIds);

  function openPopover() {
    setPendingOwnerId(ownerId);
    setPendingCoOwnerIds(coOwnerIds);
    setOpen(true);
  }

  function closePopover() {
    setOpen(false);
    const ownerChanged = pendingOwnerId !== ownerId;
    const originalCo = new Set(coOwnerIds);
    const nextCo = new Set(pendingCoOwnerIds);
    const toAdd = [...nextCo].filter((id) => !originalCo.has(id));
    const toRemove = [...originalCo].filter((id) => !nextCo.has(id));
    if (!ownerChanged && toAdd.length === 0 && toRemove.length === 0) return;
    startTransition(async () => {
      if (ownerChanged) await updateDealOwner(dealId, pendingOwnerId);
      for (const id of toAdd) await addDealOwner(dealId, id);
      for (const id of toRemove) await removeDealOwner(dealId, id);
    });
  }

  // Klikk på hovedeieren fjerner den (deal-en kan stå uten eier) — for å
  // gjøre noen ANNEN til hovedeier, bruk stjerne-knappen på en med-eier.
  function toggle(userId: number) {
    if (userId === pendingOwnerId) {
      setPendingOwnerId(null);
      return;
    }
    setPendingCoOwnerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function makeMain(userId: number) {
    if (userId === pendingOwnerId) return;
    const oldOwnerId = pendingOwnerId;
    setPendingOwnerId(userId);
    setPendingCoOwnerIds((prev) => {
      const next = prev.filter((id) => id !== userId);
      if (oldOwnerId != null && !next.includes(oldOwnerId)) next.push(oldOwnerId);
      return next;
    });
  }

  const coOwnerCount = coOwnerIds.length;

  return (
    <span className="relative flex justify-center">
      <button
        type="button"
        onClick={() => (open ? closePopover() : openPopover())}
        disabled={pending}
        title={
          ownerId == null
            ? "Ingen eier (klikk for å endre)"
            : `Eier: ${ownerName} (klikk for å endre)`
        }
        className="rounded-full transition disabled:opacity-60"
      >
        {ownerId == null ? (
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full bg-warning/15 text-warning"
            title="Ingen eier"
          >
            <TriangleAlert size={15} />
          </span>
        ) : (
          <Avatar name={ownerName} imageUrl={ownerAvatarUrl} size={28} />
        )}
      </button>
      {coOwnerCount > 0 && (
        <span
          title={`${coOwnerCount} med-eier${coOwnerCount === 1 ? "" : "e"}`}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-mist/[0.08] text-[9px] font-semibold text-ink-soft"
        >
          +{coOwnerCount}
        </span>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={closePopover} />
          <div className="absolute left-1/2 top-full z-40 mt-1.5 w-56 -translate-x-1/2 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              Eiere
            </p>
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {owners.map((o) => {
                const isMain = o.id === pendingOwnerId;
                const isCo = pendingCoOwnerIds.includes(o.id);
                const checked = isMain || isCo;
                return (
                  <li
                    key={o.id}
                    className="group flex items-center gap-1 rounded-lg hover:bg-mist/[0.05]"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
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
                    {isCo && !isMain && (
                      <button
                        type="button"
                        onClick={() => makeMain(o.id)}
                        title="Gjør til hovedeier"
                        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint opacity-0 transition hover:bg-mist/[0.08] hover:text-accent group-hover:opacity-100"
                      >
                        <Star size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
