"use client";

import { useState, useTransition } from "react";
import { syncEmailsNow } from "@/lib/actions";
import { RefreshCw } from "lucide-react";

export default function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const res = await syncEmailsNow();
            setMessage({ ok: res.ok, text: res.message });
          })
        }
        className="btn btn-secondary"
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
        {pending ? "Synkroniserer …" : "Synkroniser nå"}
      </button>
      {message && (
        <p className={`text-[13px] ${message.ok ? "text-ink-soft" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
