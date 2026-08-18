"use client";

import { useState, useTransition } from "react";
import { deleteUser, setUserPassword } from "@/lib/actions";
import { KeyRound, Trash2 } from "lucide-react";

export default function UserActions({
  userId,
  canDelete = true,
}: {
  userId: number;
  canDelete?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "password" | "confirmDelete">("idle");
  const [password, setPasswordValue] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function reset() {
    setMode("idle");
    setPasswordValue("");
  }

  function submitPassword() {
    if (password.length < 8) {
      setMessage({ ok: false, text: "Passordet må være minst 8 tegn." });
      return;
    }
    const fd = new FormData();
    fd.set("password", password);
    startTransition(async () => {
      const res = await setUserPassword(userId, fd);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) reset();
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteUser(userId);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) reset();
    });
  }

  if (mode === "password") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            autoFocus
            minLength={8}
            placeholder="Nytt passord (minst 8 tegn)"
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
            className="field !py-1.5 text-[12.5px]"
          />
          <button
            type="button"
            disabled={pending}
            onClick={submitPassword}
            className="btn btn-secondary shrink-0 !px-3 !py-1.5 text-[12px]"
          >
            Lagre
          </button>
          <button
            type="button"
            onClick={reset}
            className="shrink-0 px-2 text-[12px] text-ink-faint hover:text-ink"
          >
            Avbryt
          </button>
        </div>
        {message && !message.ok && (
          <p className="text-[11.5px] text-danger">{message.text}</p>
        )}
      </div>
    );
  }

  if (mode === "confirmDelete") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-ink-soft">Slette brukeren?</span>
          <button
            type="button"
            disabled={pending}
            onClick={confirmDelete}
            className="btn btn-danger shrink-0 !px-3 !py-1.5 text-[12px]"
          >
            Ja, slett
          </button>
          <button
            type="button"
            onClick={reset}
            className="shrink-0 px-2 text-[12px] text-ink-faint hover:text-ink"
          >
            Avbryt
          </button>
        </div>
        {message && !message.ok && (
          <p className="text-[11.5px] text-danger">{message.text}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        title="Sett nytt passord"
        onClick={() => {
          setMessage(null);
          setMode("password");
        }}
        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition hover:bg-mist/[0.06] hover:text-ink"
      >
        <KeyRound size={14} />
      </button>
      {canDelete && (
        <button
          type="button"
          title="Slett bruker"
          onClick={() => {
            setMessage(null);
            setMode("confirmDelete");
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
