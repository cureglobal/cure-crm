"use client";

import { useState, useTransition } from "react";
import { setUserBusinessUnit } from "@/lib/actions";

export default function UserBusinessUnitSelect({
  userId,
  initialBusinessUnitId,
  units,
}: {
  userId: number;
  initialBusinessUnitId: number | null;
  units: { id: number; name: string }[];
}) {
  const [value, setValue] = useState(
    initialBusinessUnitId ? String(initialBusinessUnitId) : ""
  );
  const [, startTransition] = useTransition();

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        startTransition(() => setUserBusinessUnit(userId, v ? Number(v) : null));
      }}
      className="field !w-auto shrink-0 !rounded-full !py-1.5 text-[11.5px]"
    >
      <option value="">Ikke satt</option>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}
