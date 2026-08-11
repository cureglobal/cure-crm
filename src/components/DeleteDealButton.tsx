"use client";

import { useTransition } from "react";
import { deleteDeal } from "@/lib/actions";
import { Trash2 } from "lucide-react";

export default function DeleteDealButton({ dealId }: { dealId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm("Slette denne dealen? Varelinjer og notater fjernes.")) {
          startTransition(async () => {
            await deleteDeal(dealId);
          });
        }
      }}
      className="btn btn-danger"
    >
      <Trash2 size={14} />
      Slett deal
    </button>
  );
}
