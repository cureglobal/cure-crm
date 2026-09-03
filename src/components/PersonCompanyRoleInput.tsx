"use client";

import { useTransition } from "react";
import { updatePersonCompanyRole } from "@/lib/actions";

export default function PersonCompanyRoleInput({
  personId,
  companyId,
  initialRole,
}: {
  personId: number;
  companyId: number;
  initialRole: string | null;
}) {
  const [, startTransition] = useTransition();

  function save(value: string) {
    const trimmed = value.trim();
    if (trimmed === (initialRole ?? "")) return;
    const fd = new FormData();
    fd.set("role", trimmed);
    startTransition(() => updatePersonCompanyRole(personId, companyId, fd));
  }

  return (
    <input
      defaultValue={initialRole ?? ""}
      onBlur={(e) => save(e.target.value)}
      placeholder="Tittel/rolle …"
      className="field !w-auto !border-transparent !bg-transparent !px-1.5 !py-0.5 text-[12px] text-ink-soft hover:!border-line focus:!border-accent focus:!bg-surface"
    />
  );
}
