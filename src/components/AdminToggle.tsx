"use client";

import { useState, useTransition } from "react";
import { setUserAdmin } from "@/lib/actions";
import { ShieldCheck, Shield } from "lucide-react";

export default function AdminToggle({
  userId,
  initialIsAdmin,
  disabled,
}: {
  userId: number;
  initialIsAdmin: boolean;
  disabled?: boolean;
}) {
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        const next = !isAdmin;
        setIsAdmin(next);
        startTransition(() => setUserAdmin(userId, next));
      }}
      title={
        disabled
          ? "Du kan ikke endre din egen admin-status"
          : isAdmin
            ? "Fjern administrator-tilgang"
            : "Gjør til administrator"
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        isAdmin ? "bg-accent-soft text-accent" : "bg-mist/[0.06] text-ink-soft hover:text-ink"
      }`}
    >
      {isAdmin ? <ShieldCheck size={12} /> : <Shield size={12} />}
      {isAdmin ? "Administrator" : "Gjør til admin"}
    </button>
  );
}
