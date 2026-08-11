"use client";

import { useState, useTransition } from "react";
import {
  autoMatchCompany,
  searchBrregAction,
  syncCompanyFromBrreg,
} from "@/lib/actions";
import { formatDateTime, relativeDay } from "@/lib/format";
import type { BrregHit } from "@/lib/brreg";
import Avatar from "@/components/Avatar";
import {
  Building2,
  Phone,
  MapPin,
  Users,
  RefreshCw,
  Search,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
  BadgeCheck,
  Clock,
  Wand2,
} from "lucide-react";

export interface CompanyFactsData {
  id: number;
  name: string;
  orgName: string | null;
  orgNumber: string | null;
  brregVerified: boolean;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  employees: number | null;
  industry: string | null;
  ceoName: string | null;
  revenue: number | null;
  profit: number | null;
  fiscalYear: string | null;
  brregSyncedAt: number | null;
}

export interface LastContact {
  at: number;
  by: string | null;
  kind: string;
}

const KIND_LABEL: Record<string, string> = {
  moete: "møte",
  telefon: "telefon",
  epost: "e-post",
  annet: "kontakt",
};

// brreg oppgir beløp i hele kroner; vi viser tusen kroner slik brreg/Proff gjør.
function thousands(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("nb-NO").format(Math.round(value / 1000));
}

export function formatOrgNumber(org: string | null): string {
  if (!org) return "";
  return org.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

export default function CompanyFacts({
  company,
  lastContact,
}: {
  company: CompanyFactsData;
  lastContact: LastContact | null;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [orgInput, setOrgInput] = useState("");
  const [hits, setHits] = useState<BrregHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showFix, setShowFix] = useState(false);

  function sync(orgNumber?: string) {
    startTransition(async () => {
      setMessage(null);
      setHits(null);
      const res = await syncCompanyFromBrreg(company.id, orgNumber);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) setShowFix(false);
    });
  }

  function autoMatch() {
    startTransition(async () => {
      setMessage(null);
      const res = await autoMatchCompany(company.id);
      setMessage({ ok: res.matched, text: res.message });
      if (!res.matched) setShowFix(true);
    });
  }

  async function lookup() {
    setSearching(true);
    setMessage(null);
    const res = await searchBrregAction(orgInput || company.name);
    setHits(res);
    setSearching(false);
    if (res.length === 0) {
      setMessage({ ok: false, text: "Ingen treff i Enhetsregisteret." });
    }
  }

  const profitPositive = (company.profit ?? 0) >= 0;
  const year = company.fiscalYear ?? "";
  const rel = lastContact ? relativeDay(new Date(lastContact.at)) : null;

  return (
    <section className="card p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">Firmainformasjon</h2>
          {company.orgName && company.orgName !== company.name && (
            <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">
              Org. navn: {company.orgName}
            </p>
          )}
        </div>
        <button
          onClick={() => (company.orgNumber ? sync() : autoMatch())}
          disabled={pending}
          title={
            company.orgNumber
              ? "Hent oppdatert info fra Brønnøysundregistrene"
              : "Søk opp selskapet automatisk i Enhetsregisteret"
          }
          className="btn btn-secondary shrink-0"
        >
          {company.orgNumber ? (
            <RefreshCw size={13} className={pending ? "animate-spin" : ""} />
          ) : (
            <Wand2 size={13} className={pending ? "animate-pulse" : ""} />
          )}
          {pending ? "Henter …" : company.orgNumber ? "Oppdater fra brreg" : "Finn i brreg"}
        </button>
      </div>

      {message && (
        <p
          className={`mb-4 rounded-xl px-4 py-2.5 text-[13px] font-medium ${
            message.ok ? "bg-success/10 text-[#1d7a3a]" : "bg-warning/10 text-[#8a5a00]"
          }`}
        >
          {message.text}
        </p>
      )}

      {!company.brregVerified && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-warning/10 px-4 py-3">
          <TriangleAlert size={16} className="shrink-0 text-[#b06a00]" />
          <p className="flex-1 text-[13px] font-medium text-[#8a5a00]">
            Selskapet er ikke bekreftet mot Enhetsregisteret.
          </p>
          <button
            onClick={() => setShowFix((v) => !v)}
            className="shrink-0 text-[12.5px] font-semibold text-[#8a5a00] underline hover:no-underline"
          >
            {showFix ? "Skjul" : "Finn riktig selskap"}
          </button>
        </div>
      )}

      <dl className="flex flex-wrap items-center gap-x-7 gap-y-2.5 text-[13.5px]">
        {rel && (
          <div className="flex items-center gap-2">
            <Clock size={15} className="shrink-0 text-ink-faint" />
            <dt className="text-ink-soft">Sist kontakt</dt>
            <dd
              className={`flex items-center gap-1.5 font-medium ${
                rel.tone === "overdue" ? "" : "text-[#1d7a3a]"
              }`}
            >
              {rel.label}
              <span className="font-normal text-ink-soft">
                · {KIND_LABEL[lastContact!.kind] ?? lastContact!.kind}
              </span>
              {lastContact!.by && (
                <>
                  <Avatar name={lastContact!.by} size={18} />
                  <span className="font-normal text-ink-soft">{lastContact!.by}</span>
                </>
              )}
            </dd>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Building2 size={15} className="shrink-0 text-ink-faint" />
          <dt className="text-ink-soft">Org nr</dt>
          <dd className="flex items-center gap-1.5 font-medium tabular-nums">
            {company.orgNumber ? formatOrgNumber(company.orgNumber) : "—"}
            {company.brregVerified && (
              <BadgeCheck size={14} className="text-accent" aria-label="Bekreftet" />
            )}
          </dd>
        </div>
        {company.phone && (
          <div className="flex items-center gap-2">
            <Phone size={15} className="shrink-0 text-ink-faint" />
            <dt className="text-ink-soft">Telefon</dt>
            <dd className="font-medium">
              <a
                href={`tel:${company.phone.replace(/\s/g, "")}`}
                className="hover:text-accent"
              >
                {company.phone}
              </a>
            </dd>
          </div>
        )}
        {(company.address || company.city) && (
          <div className="flex items-center gap-2">
            <MapPin size={15} className="shrink-0 text-ink-faint" />
            <dd className="font-medium">
              {[company.address, [company.postalCode, company.city].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl bg-black/[0.03] px-5 py-4 sm:grid-cols-4">
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-soft">
            Driftsinntekter {year}
          </p>
          <p className="mt-0.5 text-[17px] font-semibold tabular-nums tracking-tight">
            {thousands(company.revenue)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-soft">
            Resultat {year}
          </p>
          <p
            className={`mt-0.5 flex items-center gap-1 text-[17px] font-semibold tabular-nums tracking-tight ${
              company.profit == null ? "" : profitPositive ? "text-[#1d7a3a]" : "text-danger"
            }`}
          >
            {company.profit != null &&
              (profitPositive ? (
                <TrendingUp size={14} className="shrink-0" />
              ) : (
                <TrendingDown size={14} className="shrink-0" />
              ))}
            {thousands(company.profit)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-soft">
            Ansatte
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[17px] font-semibold tabular-nums tracking-tight">
            {company.employees != null && (
              <Users size={14} className="shrink-0 text-ink-faint" />
            )}
            {company.employees ?? "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-soft">
            Daglig leder
          </p>
          <p
            className="mt-0.5 truncate text-[15px] font-medium tracking-tight"
            title={company.ceoName ?? ""}
          >
            {company.ceoName ?? "—"}
          </p>
        </div>
      </div>

      {company.industry && (
        <div className="mt-3">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent">
            {company.industry}
          </span>
        </div>
      )}

      {(showFix || !company.orgNumber) && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-[12.5px] text-ink-soft">
            Søk opp riktig selskap på navn eller organisasjonsnummer:
          </p>
          <div className="flex gap-2">
            <input
              value={orgInput}
              onChange={(e) => setOrgInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  lookup();
                }
              }}
              placeholder={company.name}
              className="field"
            />
            <button onClick={lookup} disabled={searching} className="btn btn-primary shrink-0">
              <Search size={13} />
              {searching ? "Søker …" : "Søk"}
            </button>
          </div>

          {hits && hits.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {hits.map((h) => (
                <li key={h.orgNumber}>
                  <button
                    onClick={() => sync(h.orgNumber)}
                    disabled={pending}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent-soft"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{h.name}</p>
                      <p className="truncate text-[12px] text-ink-soft">
                        {[
                          formatOrgNumber(h.orgNumber),
                          h.orgForm,
                          h.city,
                          h.employees != null ? `${h.employees} ansatte` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12.5px] font-medium text-accent">Velg</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {company.brregSyncedAt != null && (
        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-faint">
          Tall fra Brønnøysundregistrene, hentet{" "}
          {formatDateTime(new Date(company.brregSyncedAt))}. Beløp i tusen kroner.
        </p>
      )}
    </section>
  );
}
