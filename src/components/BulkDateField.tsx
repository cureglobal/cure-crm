"use client";

import { useState } from "react";
import CalendarPopover from "@/components/CalendarPopover";
import { CalendarDays } from "lucide-react";

// Datovelger for flervalg — ingen enkelt "gjeldende" dato å vise siden de
// valgte deal-ene kan ha ulik oppfølgingsdato fra før, så knappen viser bare
// en handling ("Sett dato …"), ikke en verdi.
export default function BulkDateField({
  onChoose,
  disabled,
}: {
  onChoose: (dateStr: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="field flex !w-auto items-center gap-1.5 !rounded-full !py-1.5 text-[12.5px]"
      >
        <CalendarDays size={13} />
        Sett dato …
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <CalendarPopover
            value=""
            onChoose={(d) => {
              onChoose(d);
              setOpen(false);
            }}
          />
        </>
      )}
    </div>
  );
}
