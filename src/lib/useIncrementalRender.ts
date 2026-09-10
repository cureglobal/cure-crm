"use client";

import { useEffect, useRef, useState } from "react";

// Listesidene har all data i nettleseren for at søk og sortering skal være
// umiddelbart. Problemet er ikke dataene — 893 selskaper er ~345 kB — men at
// HTML-en for 893 rader er ~1,8 MB. Derfor rendres bare de øverste radene
// først, og flere legges til når man nærmer seg bunnen.
//
// Filtrering, sortering og "velg alle" jobber fortsatt på HELE lista; det er
// kun antall rader i DOM-en dette begrenser. Merk at nettleserens egen
// Ctrl+F ikke finner rader som ennå ikke er rendret — bruk søkefeltet.
const INITIAL_COUNT = 60;
const STEP = 60;

// Tabellene ligger i en egen boks som ruller for seg selv
// (`card overflow-auto max-h-[75vh]`), ikke sammen med siden. Da må
// IntersectionObserver-en bruke NETTOPP den boksen som `root` — med
// standard root (vindusruta) ville rootMargin blitt regnet mot vinduet, og
// neste bunke ville kommet først når man var helt nede, med et synlig hakk.
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null; // ingen egen rullboks — da er vindusruta riktig
}

export function useIncrementalRender<T>(items: T[]) {
  const [limit, setLimit] = useState(INITIAL_COUNT);
  const [seenItems, setSeenItems] = useState(items);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Nytt søk eller ny sortering betyr en ny liste å se på — da skal man
  // begynne på toppen igjen, ikke arve rullehøyden fra forrige liste.
  //
  // Justeres under render, ikke i en useEffect: en effekt ville først latt
  // React tegne den gamle grensen og deretter tvunget en ny render. Dette er
  // Reacts anbefalte mønster for tilstand som må følge en prop.
  if (items !== seenItems) {
    setSeenItems(items);
    setLimit(INITIAL_COUNT);
  }

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || limit >= items.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // rootMargin gjør at neste bunke er på plass før man ser bunnen.
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((n) => Math.min(n + STEP, items.length));
        }
      },
      { root: findScrollParent(el), rootMargin: "800px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [limit, items.length]);

  return {
    rendered: items.slice(0, limit),
    sentinelRef,
    hiddenCount: Math.max(0, items.length - limit),
  };
}
