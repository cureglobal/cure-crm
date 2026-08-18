"use client";

import { useState, useTransition } from "react";
import { addDealOwner, removeDealOwner, updateDealOwner } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { Plus, X, TriangleAlert } from "lucide-react";

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

  const pickable = allUsers.filter(
    (u) => u.id !== primaryOwner?.id && !coOwners.some((c) => c.id === u.id)
  );

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
        onClick={() => setOpen((v) => !v)}
        title="Legg til eier"
        className="flex h-5 w-5 items-center justify-center rounded-full bg-mist/[0.06] text-ink-faint transition hover:bg-mist/[0.1] hover:text-ink"
      >
        <Plus size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-30 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-card">
          {pickable.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-ink-faint">Alle er allerede eiere.</p>
          ) : (
            pickable.map((u) => (
              <button
                key={u.id}
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    if (!primaryOwner) {
                      await updateDealOwner(dealId, u.id);
                    } else {
                      await addDealOwner(dealId, u.id);
                    }
                  });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition hover:bg-mist/[0.04]"
              >
                <Avatar name={u.name} imageUrl={u.avatarDataUrl} size={18} />
                {u.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
