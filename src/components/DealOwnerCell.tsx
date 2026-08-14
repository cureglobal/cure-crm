"use client";

import { useState, useTransition } from "react";
import { updateDealOwner } from "@/lib/actions";
import Avatar from "@/components/Avatar";

export default function DealOwnerCell({
  dealId,
  ownerId,
  ownerName,
  ownerAvatarUrl,
  coOwnerCount,
  owners,
}: {
  dealId: number;
  ownerId: number;
  ownerName: string;
  ownerAvatarUrl: string | null;
  coOwnerCount: number;
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(id: number) {
    setOpen(false);
    if (id === ownerId) return;
    startTransition(() => updateDealOwner(dealId, id));
  }

  return (
    <span className="relative flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        title={`Eier: ${ownerName} (klikk for å endre)`}
        className="rounded-full transition disabled:opacity-60"
      >
        <Avatar name={ownerName} imageUrl={ownerAvatarUrl} size={28} />
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
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-full z-40 mt-1.5 w-48 -translate-x-1/2 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {owners.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => choose(o.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition ${
                      o.id === ownerId
                        ? "bg-accent-soft font-medium text-accent"
                        : "hover:bg-mist/[0.05]"
                    }`}
                  >
                    <Avatar name={o.name} imageUrl={o.avatarDataUrl} size={18} />
                    {o.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
