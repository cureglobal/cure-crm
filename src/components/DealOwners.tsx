"use client";

import { useState, useTransition } from "react";
import { addDealOwner, removeDealOwner, updateDealOwner } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { Plus, X, Check, Star, TriangleAlert } from "lucide-react";

export interface OwnerOption {
  id: number;
  name: string;
  avatarDataUrl: string | null;
}

export default function DealOwners({
  dealId,
  primaryOwner,
  coOwners,
  allUsers,
}: {
  dealId: number;
  primaryOwner: OwnerOption | null;
  coOwners: OwnerOption[];
  allUsers: OwnerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Endringer gjøres kun lokalt mens popover-en er åpen, og sendes til
  // serveren først når man lukker den — samme mønster som DealOwnerCell
  // i Pipeline-listen ("samlebildet for deals"), slik at man kan bytte
  // hovedeier og justere med-eiere i én operasjon.
  const [pendingOwnerId, setPendingOwnerId] = useState(primaryOwner?.id ?? null);
  const [pendingCoOwnerIds, setPendingCoOwnerIds] = useState<number[]>(coOwners.map((o) => o.id));

  function openPopover() {
    setPendingOwnerId(primaryOwner?.id ?? null);
    setPendingCoOwnerIds(coOwners.map((o) => o.id));
    setOpen(true);
  }

  function closePopover() {
    setOpen(false);
    const ownerChanged = pendingOwnerId !== (primaryOwner?.id ?? null);
    const originalCo = new Set(coOwners.map((o) => o.id));
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

  return (
    <div className="relative flex items-center gap-1">
      <span>Eiere:</span>
      {primaryOwner ? (
        <span className="group relative">
          <Avatar
            name={primaryOwner.name}
            imageUrl={primaryOwner.avatarDataUrl}
            size={20}
            title={`${primaryOwner.name} (hovedeier)`}
          />
          <button
            disabled={pending}
            onClick={() => startTransition(async () => { await updateDealOwner(dealId, null); })}
            title="Fjern som eier"
            className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-chip-dark text-white group-hover:flex"
          >
            <X size={9} />
          </button>
        </span>
      ) : (
        <span
          title="Ingen eier"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-warning/15 text-warning"
        >
          <TriangleAlert size={11} />
        </span>
      )}
      {coOwners.map((o) => (
        <span key={o.id} className="group relative">
          <Avatar name={o.name} imageUrl={o.avatarDataUrl} size={20} title={o.name} />
          <button
            disabled={pending}
            onClick={() => startTransition(async () => { await removeDealOwner(dealId, o.id); })}
            title={`Fjern ${o.name} som eier`}
            className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-chip-dark text-white group-hover:flex"
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <button
        onClick={() => (open ? closePopover() : openPopover())}
        disabled={pending}
        title="Endre eiere"
        className="flex h-5 w-5 items-center justify-center rounded-full bg-mist/[0.06] text-ink-faint transition hover:bg-mist/[0.1] hover:text-ink disabled:opacity-60"
      >
        <Plus size={12} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={closePopover} />
          <div className="absolute left-0 top-6 z-40 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              Eiere
            </p>
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {allUsers.map((u) => {
                const isMain = u.id === pendingOwnerId;
                const isCo = pendingCoOwnerIds.includes(u.id);
                const checked = isMain || isCo;
                return (
                  <li
                    key={u.id}
                    className="group/row flex items-center gap-1 rounded-lg hover:bg-mist/[0.05]"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(u.id)}
                      className="flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12.5px] transition"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? "border-accent bg-accent text-accent-ink" : "border-line"
                        }`}
                      >
                        {checked && <Check size={11} strokeWidth={3} />}
                      </span>
                      <Avatar name={u.name} imageUrl={u.avatarDataUrl} size={18} />
                      <span className="min-w-0 flex-1 truncate">{u.name}</span>
                      {isMain && (
                        <span className="shrink-0 text-[10.5px] text-ink-faint">Hovedeier</span>
                      )}
                    </button>
                    {isCo && !isMain && (
                      <button
                        type="button"
                        onClick={() => makeMain(u.id)}
                        title="Gjør til hovedeier"
                        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint opacity-0 transition hover:bg-mist/[0.08] hover:text-accent group-hover/row:opacity-100"
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
    </div>
  );
}
