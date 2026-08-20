"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// Skjuler innhold bak en "Vis/Skjul"-knapp — for lange seksjoner i
// Innstillinger der selve overskriften/beskrivelsen skal være synlig hele
// tiden, men det tunge innholdet under bare når man faktisk trenger det.
export default function CollapsibleSection({
  defaultOpen = false,
  children,
}: {
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft transition hover:text-ink"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Skjul" : "Vis"}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
