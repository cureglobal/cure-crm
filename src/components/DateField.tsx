"use client";

import { useState } from "react";
import CalendarPopover, { parseDateStr } from "@/components/CalendarPopover";

// Kort format uten årstall (f.eks. "17. aug") — plass er trangt i listevisningen.
function formatShort(d: Date) {
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

// Kompakt datovelger i appens eget design — erstatter <input type="date">,
// som viser nettleserens native kalender-popup uansett hvor i feltet man
// klikker (ikke bare på ikonet), og som ikke kan restyles til å matche resten.
export default function DateField({
  value,
  onChange,
  className = "",
  overdue = false,
}: {
  value: string; // yyyy-mm-dd, eller "" for ingen dato
  onChange: (value: string) => void;
  className?: string;
  overdue?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateStr(value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full truncate text-left ${className} ${overdue ? "!font-medium !text-danger" : ""}`}
      >
        {selected ? formatShort(selected) : "—"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <CalendarPopover
            value={value}
            onChoose={(d) => {
              onChange(d);
              setOpen(false);
            }}
            onClear={
              value
                ? () => {
                    onChange("");
                    setOpen(false);
                  }
                : undefined
            }
          />
        </>
      )}
    </div>
  );
}
