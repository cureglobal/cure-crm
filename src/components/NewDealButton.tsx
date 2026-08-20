"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { createDeal, searchBrregAction } from "@/lib/actions";
import type { BrregHit } from "@/lib/brreg";
import CompanyLogo from "@/components/CompanyLogo";
import { Plus, Sparkles, X, Search, Check, Building2 } from "lucide-react";

export interface CompanyOption {
  id: number;
  name: string;
  logoUrl: string | null;
}

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

export default function NewDealButton({
  companies = [],
  pipelines,
  pipelineId,
}: {
  companies?: CompanyOption[];
  pipelines: { id: number; name: string }[];
  // Satt: låst til denne (brukes fra Pipeline-siden, der pipelinen allerede
  // er valgt i visningen — ingen grunn til å spørre igjen). Usatt: viser en
  // velger hvis det finnes mer enn én pipeline (brukes fra dashboardet, som
  // ikke har noen "gjeldende" pipeline å arve fra).
  pipelineId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState(pipelineId ?? pipelines[0]?.id ?? 1);
  const [mode, setMode] = useState<"eksisterende" | "nytt">(
    companies.length > 0 ? "eksisterende" : "nytt"
  );
  const [companySearch, setCompanySearch] = useState("");
  const [selected, setSelected] = useState<CompanyOption | null>(null);

  const [newCompanyName, setNewCompanyName] = useState("");
  const [brregHits, setBrregHits] = useState<BrregHit[]>([]);
  const [brregSelected, setBrregSelected] = useState<BrregHit | null>(null);
  const [searchingBrreg, startBrregSearch] = useTransition();

  const matches = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    const list = q
      ? companies.filter((c) => c.name.toLowerCase().includes(q))
      : companies;
    return list.slice(0, 6);
  }, [companies, companySearch]);

  // Live søk mot Brønnøysundregisteret mens man skriver inn navnet på et
  // selskap som ikke finnes i CRM-et fra før.
  /* eslint-disable react-hooks/set-state-in-effect -- rydder søketreff momentant når input blir for kort */
  useEffect(() => {
    if (mode !== "nytt" || brregSelected) return;
    const q = newCompanyName.trim();
    if (q.length < 2) {
      setBrregHits([]);
      return;
    }
    const timer = setTimeout(() => {
      startBrregSearch(async () => {
        setBrregHits(await searchBrregAction(q));
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [newCompanyName, mode, brregSelected]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function close() {
    setOpen(false);
    setSelected(null);
    setCompanySearch("");
    setNewCompanyName("");
    setBrregHits([]);
    setBrregSelected(null);
    setMode(companies.length > 0 ? "eksisterende" : "nytt");
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <Plus size={15} strokeWidth={2.2} />
        Ny deal
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
              <h2 className="text-lg font-semibold tracking-tight">Ny deal</h2>
              <button
                onClick={close}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
              >
                <X size={16} />
              </button>
            </div>

            {companies.length > 0 && (
              <div className="mb-4 flex rounded-full bg-mist/[0.05] p-1">
                {(["eksisterende", "nytt"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      setSelected(null);
                      setBrregSelected(null);
                      if (m === "nytt") setNewCompanyName((v) => v || companySearch);
                    }}
                    className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                      mode === m ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
                    }`}
                  >
                    {m === "eksisterende" ? "Eksisterende selskap" : "Nytt selskap"}
                  </button>
                ))}
              </div>
            )}

            <form action={createDeal} className="flex flex-col gap-3">
              {pipelineId != null ? (
                <input type="hidden" name="pipelineId" value={pipelineId} />
              ) : (
                pipelines.length > 1 && (
                  <input type="hidden" name="pipelineId" value={selectedPipelineId} />
                )
              )}
              {pipelineId == null && pipelines.length > 1 && (
                <label className="text-[12px] font-medium text-ink-soft">
                  Pipeline
                  <select
                    value={selectedPipelineId}
                    onChange={(e) => setSelectedPipelineId(Number(e.target.value))}
                    className="field mt-1"
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mode === "eksisterende" ? (
                <>
                  <input type="hidden" name="companyId" value={selected?.id ?? ""} />
                  {selected ? (
                    <div className="flex items-center gap-2.5 rounded-xl bg-accent-soft/60 px-3 py-2.5">
                      <CompanyLogo
                        logoUrl={selected.logoUrl}
                        name={selected.name}
                        size={28}
                        radius={8}
                      />
                      <span className="flex-1 truncate text-[13.5px] font-medium">
                        {selected.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelected(null)}
                        className="text-[12.5px] font-medium text-accent hover:underline"
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
                          value={companySearch}
                          onChange={(e) => setCompanySearch(e.target.value)}
                          autoFocus
                          placeholder="Søk etter selskap …"
                          className="field !pl-8"
                        />
                      </div>
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {matches.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => setSelected(c)}
                              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-mist/[0.04]"
                            >
                              <CompanyLogo
                                logoUrl={c.logoUrl}
                                name={c.name}
                                size={24}
                                radius={7}
                              />
                              <span className="flex-1 truncate text-[13px]">{c.name}</span>
                              <Check size={13} className="text-ink-faint opacity-0" />
                            </button>
                          </li>
                        ))}
                        {matches.length === 0 && (
                          <li className="px-2.5 py-2 text-[12.5px] text-ink-faint">
                            Ingen treff. Bytt til «Nytt selskap» for å opprette{" "}
                            {companySearch.trim() && `«${companySearch.trim()}»`}.
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-xl bg-mist/[0.03] px-3 py-2 text-[12px] text-ink-soft">
                    <Building2 size={13} className="shrink-0" />
                    Søk i Brønnøysundregisteret mens du skriver, eller fyll inn manuelt.
                  </div>

                  {brregSelected ? (
                    <>
                      <input type="hidden" name="companyName" value={brregSelected.name} />
                      <input type="hidden" name="orgNumber" value={brregSelected.orgNumber} />
                      <div className="flex items-center gap-2.5 rounded-xl bg-accent-soft/60 px-3 py-2.5">
                        <Building2 size={16} className="shrink-0 text-accent" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {brregSelected.name}
                          </span>
                          <span className="block text-[11.5px] text-ink-soft">
                            {brregSelected.orgNumber}
                            {brregSelected.city ? ` · ${brregSelected.city}` : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setBrregSelected(null)}
                          className="shrink-0 text-[12.5px] font-medium text-accent hover:underline"
                        >
                          Bytt
                        </button>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div className="relative">
                        <Search
                          size={13}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                        />
                        <input
                          name="companyName"
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          required
                          autoFocus
                          placeholder="Selskapsnavn"
                          className="field !pl-8"
                        />
                      </div>
                      {newCompanyName.trim().length >= 2 && (
                        <ul className="mt-1.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                          {brregHits.map((h) => (
                            <li key={h.orgNumber}>
                              <button
                                type="button"
                                onClick={() => setBrregSelected(h)}
                                className="flex w-full flex-col items-start rounded-xl px-2.5 py-2 text-left transition hover:bg-mist/[0.04]"
                              >
                                <span className="text-[13px]">{h.name}</span>
                                <span className="text-[11.5px] text-ink-faint">
                                  {h.orgNumber}
                                  {h.city ? ` · ${h.city}` : ""}
                                </span>
                              </button>
                            </li>
                          ))}
                          {searchingBrreg && (
                            <li className="px-2.5 py-2 text-[12.5px] text-ink-faint">
                              Søker i Brreg …
                            </li>
                          )}
                        </ul>
                      )}
                      <input
                        name="orgNumber"
                        inputMode="numeric"
                        placeholder="Organisasjonsnummer (valgfritt, hvis ikke funnet over)"
                        className="field mt-2"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="border-t border-line pt-3">
                <input
                  name="dealTitle"
                  placeholder="Hva gjelder dealen? (f.eks. Nettsider)"
                  className="field"
                />
              </div>

              <input
                name="email"
                type="email"
                placeholder="Kontaktens e-post (valgfritt)"
                className="field"
              />
              <input
                name="contactName"
                placeholder="Kontaktperson (valgfritt)"
                className="field"
              />

              <SubmitButton
                label={
                  mode === "eksisterende" && selected
                    ? `Opprett deal på ${selected.name}`
                    : mode === "nytt" && brregSelected
                      ? `Opprett deal på ${brregSelected.name}`
                      : "Opprett deal"
                }
              />
            </form>
          </div>
        </div>
      )}
    </>
  );
}
