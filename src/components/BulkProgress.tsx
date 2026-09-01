"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} sek`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m} min ${s} sek` : `${m} min`;
}

// Snurrehjul + forløpt tid for handlinger som kan ta flere sekunder til
// minutter (CSV-import, "match alle mot Brreg", bulk-opprett deals) — så man
// ser at det jobber, ikke har låst seg. Det estimerte resttiden er bevisst
// grov (avrundet til nærmeste 10 sek) i stedet for en presis nedtelling, som
// ellers ville sett mer nøyaktig ut enn den faktisk er.
export default function BulkProgress({
  active,
  label,
  itemCount,
  secondsPerItem = 0.5,
}: {
  active: boolean;
  label: string;
  itemCount?: number;
  secondsPerItem?: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- nullstiller klokka når en ny kjøring starter */
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!active) return null;

  const estimatedTotal =
    itemCount && itemCount > 0
      ? Math.max(10, Math.round((itemCount * secondsPerItem) / 10) * 10)
      : null;
  const remaining =
    estimatedTotal != null ? Math.max(0, Math.ceil((estimatedTotal - elapsed) / 10) * 10) : null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-mist/[0.03] px-4 py-3 text-[12.5px] text-ink-soft">
      <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
      <span>
        {label} · {formatDuration(elapsed)}
        {remaining != null && remaining > 0 && <> · ca. {formatDuration(remaining)} igjen</>}
      </span>
    </div>
  );
}
