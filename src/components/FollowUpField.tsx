"use client";

import { useState, useTransition } from "react";
import { setFollowUp } from "@/lib/actions";
import DateField from "@/components/DateField";
import { CalendarClock } from "lucide-react";

// Kompakt oppfølgingsvelger til deal-sidens header — lagrer med én gang man
// velger en dato i kalenderen, uten en egen "Lagre"-knapp.
export default function FollowUpField({
  dealId,
  initialValue,
}: {
  dealId: number;
  initialValue: string; // yyyy-mm-dd, eller "" for ingen dato
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  function save(v: string) {
    setValue(v);
    const data = new FormData();
    data.set("followUpAt", v);
    startTransition(async () => {
      await setFollowUp(dealId, data);
    });
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-mist/[0.05] px-3.5 py-2 text-[13px] font-medium transition hover:bg-mist/[0.08] ${
        pending ? "opacity-60" : ""
      }`}
    >
      <CalendarClock size={14} className="text-ink-faint" />
      <DateField value={value} onChange={save} className="!w-auto !text-[13px] !font-medium" />
    </span>
  );
}
