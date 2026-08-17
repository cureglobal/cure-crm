"use client";

import { useState, useTransition } from "react";
import { addDealOwner, removeDealOwner, swapDealMainOwner } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { Check, Star } from "lucide-react";

export default function DealOwnerCell({
  dealId,
  ownerId,
  ownerName,
  ownerAvatarUrl,
  coOwnerIds,
  owners,
}: {
  dealId: number;
  ownerId: number;
  ownerName: string;
  ownerAvatarUrl: string | null;
  coOwnerIds: number[];
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(userId: number) {
    if (userId === ownerId) return; // hovedeieren fjernes via "gjør til hovedeier" på noen andre i stedet
    if (coOwnerIds.includes(userId)) {
      startTransition(() => removeDealOwner(dealId, userId));
    } else {
      startTransition(() => addDealOwner(dealId, userId));
    }
  }

  function makeMain(userId: number) {
    if (userId === ownerId) return;
    startTransition(() => swapDealMainOwner(dealId, userId));
  }

  const coOwnerCount = coOwnerIds.length;

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
          <div className="absolute left-1/2 top-full z-40 mt-1.5 w-56 -translate-x-1/2 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
              Eiere
            </p>
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {owners.map((o) => {
                const isMain = o.id === ownerId;
                const isCo = coOwnerIds.includes(o.id);
                const checked = isMain || isCo;
                return (
                  <li key={o.id} className="group flex items-center gap-1 rounded-lg hover:bg-mist/[0.05]">
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      disabled={pending || isMain}
                      className="flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12.5px] transition disabled:cursor-default"
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
                        disabled={pending}
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
