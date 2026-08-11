"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createDeal } from "@/lib/actions";
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
}: {
  companies?: CompanyOption[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"eksisterende" | "nytt">(
    companies.length > 0 ? "eksisterende" : "nytt"
  );
  const [companySearch, setCompanySearch] = useState("");
  const [selected, setSelected] = useState<CompanyOption | null>(null);

  const matches = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    const list = q
      ? companies.filter((c) => c.name.toLowerCase().includes(q))
      : companies;
    return list.slice(0, 6);
  }, [companies, companySearch]);

  function close() {
    setOpen(false);
    setSelected(null);
    setCompanySearch("");
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
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-black/5"
              >
                <X size={16} />
              </button>
            </div>

            {companies.length > 0 && (
              <div className="mb-4 flex rounded-full bg-black/[0.05] p-1">
                {(["eksisterende", "nytt"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      setSelected(null);
                    }}
                    className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                      mode === m ? "bg-white shadow-card" : "text-ink-soft hover:text-ink"
                    }`}
                  >
                    {m === "eksisterende" ? "Eksisterende selskap" : "Nytt selskap"}
                  </button>
                ))}
              </div>
            )}

            <form action={createDeal} className="flex flex-col gap-3">
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
                              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-black/[0.04]"
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
                  <div className="flex items-center gap-2 rounded-xl bg-black/[0.03] px-3 py-2 text-[12px] text-ink-soft">
                    <Building2 size={13} className="shrink-0" />
                    Legg inn orgnummer eller e-post, så henter vi firmainfo og logo automatisk.
                  </div>
                  <input
                    name="companyName"
                    required
                    autoFocus
                    defaultValue={companySearch}
                    placeholder="Selskapsnavn"
                    className="field"
                  />
                  <input
                    name="orgNumber"
                    inputMode="numeric"
                    placeholder="Organisasjonsnummer (valgfritt)"
                    className="field"
                  />
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
