"use client";

import { useTransition } from "react";
import { requestEmailAccess } from "@/lib/actions";

export default function RequestAccessButton({
  companyId,
  ownerUserId,
}: {
  companyId: number;
  ownerUserId: number;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => requestEmailAccess(companyId, ownerUserId))}
      className="btn btn-ghost"
    >
      {pending ? "Sender …" : "Be om innsyn"}
    </button>
  );
}
