"use client";

import { useTransition } from "react";
import { updateUserName } from "@/lib/actions";

export default function UserNameEdit({
  userId,
  initialName,
  isSelf,
}: {
  userId: number;
  initialName: string;
  isSelf: boolean;
}) {
  const [, startTransition] = useTransition();

  function save(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialName) return;
    const fd = new FormData();
    fd.set("name", trimmed);
    startTransition(() => updateUserName(userId, fd));
  }

  return (
    <span className="flex items-center gap-1.5">
      <input
        defaultValue={initialName}
        onBlur={(e) => save(e.target.value)}
        className="field !border-transparent !bg-transparent !px-1.5 !py-1 text-[13.5px] font-medium hover:!border-line focus:!border-accent focus:!bg-surface"
      />
      {isSelf && <span className="shrink-0 text-[12px] text-ink-faint">(deg)</span>}
    </span>
  );
}
