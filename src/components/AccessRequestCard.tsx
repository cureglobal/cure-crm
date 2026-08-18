"use client";

import { useTransition } from "react";
import Link from "next/link";
import { respondEmailAccess } from "@/lib/actions";
import { Mail } from "lucide-react";

export default function AccessRequestCard({
  grantId,
  requesterName,
  companyName,
  dealSlug,
}: {
  grantId: number;
  requesterName: string;
  companyName: string;
  dealSlug: string | null;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="card flex items-center gap-3 border-accent/20 bg-accent-soft/50 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-accent shadow-card">
        <Mail size={16} />
      </span>
      <p className="flex-1 text-[13.5px]">
        <span className="font-medium">{requesterName}</span> ber om innsyn i
        e-postdialogen din med{" "}
        {dealSlug ? (
          <Link href={`/leads/${dealSlug}`} className="font-medium text-accent hover:underline">
            {companyName}
          </Link>
        ) : (
          <span className="font-medium">{companyName}</span>
        )}
        .
      </p>
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() => startTransition(async () => respondEmailAccess(grantId, false))}
          className="btn btn-secondary"
        >
          Avslå
        </button>
        <button
          disabled={pending}
          onClick={() => startTransition(async () => respondEmailAccess(grantId, true))}
          className="btn btn-primary"
        >
          Gi innsyn
        </button>
      </div>
    </div>
  );
}
