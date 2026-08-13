"use client";

import { useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { createCompany, searchBrregAction } from "@/lib/actions";
import type { BrregHit } from "@/lib/brreg";
import { Plus, Sparkles, X, Search, Building2 } from "lucide-react";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
      {pending ? (
        <>
          <Sparkles size={15} className="animate-pulse" />
          Oppretter …
        </>
      ) : (
        label
      )}
    </button>
  );
}

export default function NewCompanyButton() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"brreg" | "manuelt">("brreg");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BrregHit[]>([]);
  const [selected, setSelected] = useState<BrregHit | null>(null);
  const [searching, startSearch] = useTransition();

  // Tømmer treffene synkront når søketeksten blir for kort til å søke —
  // samme mønster (og samme unntak) som AppShell.tsx bruker for localStorage.
  /* eslint-disable react-hooks/set-state-in-effect -- rydder søketreff momentant når input blir for kort */
  useEffect(() => {
    if (mode !== "brreg" || selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      startSearch(async () => {
        setHits(await searchBrregAction(q));
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, mode, selected]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function close() {
    setOpen(false);
    setMode("brreg");
    setQuery("");
    setHits([]);
    setSelected(null);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <Plus size={15} strokeWidth={2.2} />
        Ny bedrift
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 py-[12vh] backdrop-blur-[2px]"
          onClick={close}
        >
          <div
            className="card w-full max-w-md p-6 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Ny bedrift</h2>
              <button
                onClick={close}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mb-4 flex rounded-full bg-mist/[0.05] p-1">
              {(["brreg", "manuelt"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setSelected(null);
                  }}
                  className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                    mode === m ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {m === "brreg" ? "Søk i Brreg" : "Manuelt"}
                </button>
              ))}
            </div>

            <form action={createCompany} className="flex flex-col gap-3">
              {mode === "brreg" ? (
                <>
                  <input type="hidden" name="orgNumber" value={selected?.orgNumber ?? ""} />
                  <input type="hidden" name="name" value={selected?.name ?? ""} />
                  {selected ? (
                    <div className="flex items-center gap-2.5 rounded-xl bg-accent-soft/60 px-3 py-2.5">
                      <Building2 size={16} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {selected.name}
                        </span>
                        <span className="block text-[11.5px] text-ink-soft">
                          {selected.orgNumber}
                          {selected.city ? ` · ${selected.city}` : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelected(null)}
                        className="shrink-0 text-[12.5px] font-medium text-accent hover:underline"
                      >
                        Bytt
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="relative">
                        <Search
                          size={13}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                        />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          autoFocus
                          placeholder="Navn eller organisasjonsnummer …"
                          className="field !pl-8"
                        />
                      </div>
                      <ul className="mt-1.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                        {hits.map((h) => (
                          <li key={h.orgNumber}>
                            <button
                              type="button"
                              onClick={() => setSelected(h)}
                              className="flex w-full flex-col items-start rounded-xl px-2.5 py-2 text-left transition hover:bg-mist/[0.04]"
                            >
                              <span className="text-[13px]">{h.name}</span>
                              <span className="text-[11.5px] text-ink-faint">
                                {h.orgNumber}
                                {h.city ? ` · ${h.city}` : ""}
                                {h.industry ? ` · ${h.industry}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                        {searching && (
                          <li className="px-2.5 py-2 text-[12.5px] text-ink-faint">Søker …</li>
                        )}
                        {!searching && query.trim().length >= 2 && hits.length === 0 && (
                          <li className="px-2.5 py-2 text-[12.5px] text-ink-faint">
                            Ingen treff. Bytt til «Manuelt» for å legge til selskapet selv.
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <input
                    name="name"
                    required
                    autoFocus
                    placeholder="Selskapsnavn"
                    className="field"
                  />
                  <input
                    name="orgNumber"
                    inputMode="numeric"
                    placeholder="Organisasjonsnummer (valgfritt)"
                    className="field"
                  />
                  <input name="website" placeholder="Nettside (valgfritt)" className="field" />
                  <input name="phone" placeholder="Telefon (valgfritt)" className="field" />
                </>
              )}

              {mode === "manuelt" || selected ? (
                <SubmitButton
                  label={mode === "brreg" && selected ? `Opprett ${selected.name}` : "Opprett bedrift"}
                />
              ) : (
                <p className="text-center text-[11.5px] text-ink-faint">
                  Velg et selskap fra listen over for å fortsette.
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
