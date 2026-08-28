import { useState } from "react";

// Shift-klikk-utvidelse av en enkelt-avkrysning — samme oppførsel som
// Gmail/Utforsker/Finder: klikk setter ankeret, shift+klikk setter HELE
// intervallet mellom forrige klikk og dette til samme av/på-tilstand som
// raden du akkurat klikket på (ikke alltid "på" — shift+klikk på en allerede
// avkrysset rad fjerner intervallet igjen). `visibleOrder` må være i nøyaktig
// den rekkefølgen radene vises på skjermen (inkl. eventuell gruppering), slik
// at intervallet stemmer med det brukeren faktisk ser mellom de to klikkene.
export function useRangeToggle<T extends { id: number }>(
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>,
  visibleOrder: T[]
) {
  const [lastIndex, setLastIndex] = useState<number | null>(null);

  function toggle(id: number, index: number, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastIndex != null) {
        const [start, end] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        const willCheck = !prev.has(id);
        for (let i = start; i <= end; i++) {
          const rowId = visibleOrder[i]?.id;
          if (rowId == null) continue;
          if (willCheck) next.add(rowId);
          else next.delete(rowId);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastIndex(index);
  }

  return toggle;
}
