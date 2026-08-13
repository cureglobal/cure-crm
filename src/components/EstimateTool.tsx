"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  scanWebsiteForEstimate,
  saveEstimateToDeal,
  createDealFromEstimate,
  lookupCompanyInsight,
  lookupCompanyInsightByOrgNumber,
  searchBrregAction,
} from "@/lib/actions";
import { PHASES, DEFAULT_HOURLY_RATE, recalcProjectManagement, type PhaseKey } from "@/lib/estimator";
import type { ScanSignals } from "@/lib/estimator";
import type { BrregHit } from "@/lib/brreg";
import { formatMoney } from "@/lib/format";
import CompanyLogo from "@/components/CompanyLogo";
import ReferenceProjects, { type ReferenceProjectData } from "@/components/ReferenceProjects";
import SendQuoteButton from "@/components/SendQuoteButton";
import { Search, TriangleAlert, Check, Plus, Trash2, Globe, Layers, Building2 } from "lucide-react";

interface CompanyInsight {
  matched: {
    name: string;
    orgNumber: string;
    orgForm: string | null;
    industry: string | null;
    employees: number | null;
    revenue: number | null;
    profit: number | null;
    fiscalYear: string | null;
  };
  candidates: BrregHit[];
  confident: boolean;
  sizeTier: { label: string; budgetHint: string };
  assessment: string;
}

interface DealOption {
  id: number;
  title: string;
  companyId: number;
  companyName: string;
  logoUrl: string | null;
}

interface CustomRow {
  id: string;
  title: string;
  price: number;
}

const PL_KEY: PhaseKey = "prosjektledelse";
const HOURS_PER_DAY = 7.5;

function phaseWarning(
  key: PhaseKey,
  refs: ReferenceProjectData[]
): { name: string; estimert: number; faktisk: number; pct: number } | null {
  let worst: { name: string; estimert: number; faktisk: number; pct: number } | null = null;
  for (const r of refs) {
    const ph = r.phaseHours[key];
    if (!ph?.estimert || !ph?.faktisk) continue;
    const ratio = ph.faktisk / ph.estimert;
    if (ratio > 1.25 && (!worst || ratio > worst.pct)) {
      worst = { name: r.name, estimert: ph.estimert, faktisk: ph.faktisk, pct: ratio };
    }
  }
  return worst;
}

export default function EstimateTool({
  dealOptions,
  initialDealId,
  prefillUrl,
  prefillDealTitle,
  referenceProjects,
}: {
  dealOptions: DealOption[];
  initialDealId: number | null;
  prefillUrl: string;
  prefillDealTitle: string;
  referenceProjects: ReferenceProjectData[];
}) {
  const [url, setUrl] = useState(prefillUrl);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [signals, setSignals] = useState<ScanSignals | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [scanTags, setScanTags] = useState<string[]>([]);

  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyInsight, setCompanyInsight] = useState<CompanyInsight | null>(null);
  const [companyCandidates, setCompanyCandidates] = useState<BrregHit[]>([]);
  const [companyError, setCompanyError] = useState<string | null>(null);

  const [phaseHours, setPhaseHours] = useState<Record<PhaseKey, number>>(() =>
    Object.fromEntries(PHASES.map((p) => [p.key, 0])) as Record<PhaseKey, number>
  );
  const [hourlyRate, setHourlyRate] = useState(DEFAULT_HOURLY_RATE);
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState(0);

  const [showDays, setShowDays] = useState(false);

  const [selectedDealId, setSelectedDealId] = useState<number | "">(initialDealId ?? "");
  const [dealSearch, setDealSearch] = useState("");
  const [savePending, startSave] = useTransition();
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // "Ny deal" rett fra prisverktøyet, uten å måtte gå via Pipeline først.
  const [saveMode, setSaveMode] = useState<"eksisterende" | "ny">("eksisterende");
  const [newCompanyMode, setNewCompanyMode] = useState<"brreg" | "manuelt">("brreg");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newOrgNumber, setNewOrgNumber] = useState("");
  const [newDealTitle, setNewDealTitle] = useState("");
  const [brregHits, setBrregHits] = useState<BrregHit[]>([]);
  const [brregSelected, setBrregSelected] = useState<BrregHit | null>(null);
  const [searchingBrreg, startBrregSearch] = useTransition();
  const [createPending, startCreate] = useTransition();
  const [createdDeal, setCreatedDeal] = useState<{
    id: number;
    companyName: string;
    logoUrl: string | null;
  } | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- rydder søketreff momentant når input blir for kort */
  useEffect(() => {
    if (saveMode !== "ny" || newCompanyMode !== "brreg" || brregSelected) return;
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
  }, [newCompanyName, saveMode, newCompanyMode, brregSelected]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function runScan() {
    if (!url.trim()) return;
    setScanning(true);
    setScanError(null);
    const res = await scanWebsiteForEstimate(url);
    setScanning(false);
    if (!res.ok) {
      setScanError(res.message);
      return;
    }
    setSignals(res.result.signals);
    setPhaseHours(res.result.phaseHours);
    setScanSummary(res.result.summary);
    setScanTags(res.result.tags);

    setCompanyInsight(null);
    setCompanyCandidates([]);
    setCompanyError(null);
    setCompanyLoading(true);
    lookupCompanyInsight(url, res.result.companyNameGuess, res.result.signals.ecommerce).then((r) => {
      setCompanyLoading(false);
      if (r.ok) {
        setCompanyInsight(r.insight);
      } else {
        setCompanyError(r.message);
        setCompanyCandidates(r.candidates);
      }
    });
  }

  function pickCompanyCandidate(hit: BrregHit) {
    setCompanyLoading(true);
    setCompanyError(null);
    lookupCompanyInsightByOrgNumber(hit.orgNumber, companyCandidates, signals?.ecommerce ?? false).then((r) => {
      setCompanyLoading(false);
      if (r.ok) {
        setCompanyInsight(r.insight);
      } else {
        setCompanyError(r.message);
      }
    });
  }

  function setHours(key: PhaseKey, value: number) {
    setPhaseHours((prev) => {
      const next = { ...prev, [key]: Math.max(0, value) };
      const others = PHASES.filter((p) => p.key !== PL_KEY).map((p) => next[p.key]);
      next[PL_KEY] = recalcProjectManagement(others);
      return next;
    });
  }

  function setDays(key: PhaseKey, days: number) {
    setHours(key, Math.round(days * HOURS_PER_DAY * 100) / 100);
  }

  const otherPhasesHours = PHASES.filter((p) => p.key !== PL_KEY).reduce(
    (a, p) => a + phaseHours[p.key],
    0
  );
  const phaseValue = (otherPhasesHours + phaseHours[PL_KEY]) * hourlyRate;
  const customValue = customRows.reduce((a, r) => a + (r.price || 0), 0);
  const subtotal = phaseValue + customValue;
  const rawDiscount = discountType === "percent" ? (subtotal * discountValue) / 100 : discountValue;
  const discountAmount = Math.min(Math.max(0, rawDiscount), subtotal);
  const total = subtotal - discountAmount;
  const totalWithVat = total * 1.25;

  const selectedDeal = dealOptions.find((d) => d.id === selectedDealId);
  const filteredDeals = useMemo(() => {
    const q = dealSearch.trim().toLowerCase();
    if (!q) return dealOptions.slice(0, 8);
    return dealOptions
      .filter((d) => `${d.companyName} ${d.title}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [dealOptions, dealSearch]);

  function addCustomRow() {
    setCustomRows((rows) => [
      ...rows,
      { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: "", price: 0 },
    ]);
  }

  function buildLines(): { title: string; hours: number; rate: number }[] {
    const lines: { title: string; hours: number; rate: number }[] = [];
    for (const p of PHASES) {
      const hours = phaseHours[p.key];
      if (hours > 0) lines.push({ title: p.label, hours, rate: hourlyRate });
    }
    for (const r of customRows) {
      if (r.title.trim() && r.price > 0) lines.push({ title: r.title.trim(), hours: 1, rate: r.price });
    }
    if (discountAmount > 0) {
      const label = discountType === "percent" ? `Rabatt (${discountValue}%)` : "Rabatt";
      lines.push({ title: label, hours: 1, rate: -Math.round(discountAmount) });
    }
    return lines;
  }

  // Vi bruker en innebygd bekreftelse i stedet for window.confirm() — mer i
  // tråd med resten av appen (se f.eks. DeleteDealButton), og ikke avhengig
  // av at nettleseren faktisk viser native dialoger.
  const [confirmingSave, setConfirmingSave] = useState(false);

  function confirmSave() {
    setSaveMessage(null);
    setConfirmingSave(false);
    startSave(async () => {
      const res = await saveEstimateToDeal(Number(selectedDealId), buildLines());
      setSaveMessage({ ok: res.ok, text: res.message });
    });
  }

  function createDeal() {
    setSaveMessage(null);
    const fd = new FormData();
    if (brregSelected) {
      fd.set("companyName", brregSelected.name);
      fd.set("orgNumber", brregSelected.orgNumber);
    } else {
      fd.set("companyName", newCompanyName);
      fd.set("orgNumber", newOrgNumber);
    }
    fd.set("dealTitle", newDealTitle);
    startCreate(async () => {
      const res = await createDealFromEstimate(fd, buildLines());
      if (res.ok) {
        setCreatedDeal({ id: res.dealId, companyName: res.companyName, logoUrl: res.logoUrl });
      } else {
        setSaveMessage({ ok: false, text: res.message });
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* URL-skann */}
      <section className="card p-6">
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
          {prefillDealTitle ? `Nettside for ${prefillDealTitle}` : "Nettside"}
        </h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runScan();
                }
              }}
              placeholder="kunde.no"
              className="field !pl-9"
            />
          </div>
          <button onClick={runScan} disabled={scanning || !url.trim()} className="btn btn-primary shrink-0">
            <Search size={14} className={scanning ? "animate-pulse" : ""} />
            {scanning ? "Skanner …" : "Skann og estimer"}
          </button>
        </div>

        {scanError && (
          <p className="mt-3 rounded-xl bg-warning/10 px-4 py-2.5 text-[13px] text-warning-ink">
            {scanError}
          </p>
        )}

        {signals && (
          <>
            {scanSummary && (
              <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">{scanSummary}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-mist/[0.03] px-4 py-3">
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                <Layers size={13} className="text-ink-soft" />
                {signals.pageCount}{" "}
                {signals.pageCountSource === "sitemap"
                  ? "sider (sitemap)"
                  : signals.pageCountSource === "forside"
                    ? "lenker funnet på forsiden"
                    : "sider (usikkert)"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                  signals.complexityTier === "avansert"
                    ? "bg-danger/10 text-danger"
                    : signals.complexityTier === "middels"
                      ? "bg-warning/15 text-warning-ink"
                      : "bg-success/10 text-success-ink"
                }`}
              >
                {signals.complexityTier === "avansert"
                  ? "Avansert"
                  : signals.complexityTier === "middels"
                    ? "Middels kompleks"
                    : "Enkel"}
              </span>
              {signals.cms && (
                <span className="rounded-full bg-mist/[0.06] px-2 py-0.5 text-[11.5px] text-ink-soft">
                  {signals.cms}
                </span>
              )}
              {scanTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-mist/[0.06] px-2 py-0.5 text-[11.5px] text-ink-soft"
                >
                  {tag}
                </span>
              ))}
              <span className="ml-auto text-[11.5px] text-ink-faint">
                Automatisk anslag — juster gjerne timene selv under.
              </span>
            </div>
          </>
        )}
      </section>

      {/* Bedriftsinnsikt (Brreg + KI-vurdering) */}
      {(companyLoading || companyInsight || companyError) && (
        <section className="card p-6">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Building2 size={15} className="text-ink-soft" />
            Bedriftsinnsikt
          </h2>

          {companyLoading && (
            <p className="text-[13px] text-ink-faint">Slår opp i Brønnøysundregistrene …</p>
          )}

          {!companyLoading && companyError && !companyInsight && (
            <div>
              <p className="mb-2 text-[13px] text-ink-soft">{companyError}</p>
              {companyCandidates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {companyCandidates.slice(0, 6).map((c) => (
                    <button
                      key={c.orgNumber}
                      onClick={() => pickCompanyCandidate(c)}
                      className="rounded-full bg-mist/[0.05] px-2.5 py-1 text-[12px] text-ink-soft transition hover:bg-mist/[0.08] hover:text-ink"
                    >
                      {c.name}
                      {c.city ? ` · ${c.city}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!companyLoading && companyInsight && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-medium">{companyInsight.matched.name}</p>
                  <p className="text-[12px] text-ink-soft">
                    {companyInsight.matched.orgForm ?? "Ukjent selskapsform"} · org.nr{" "}
                    {companyInsight.matched.orgNumber}
                  </p>
                </div>
                {companyCandidates.length > 1 && (
                  <button
                    onClick={() => {
                      setCompanyInsight(null);
                      setCompanyError("Velg riktig selskap:");
                    }}
                    className="shrink-0 text-[12px] font-medium text-accent hover:underline"
                  >
                    Ikke riktig selskap?
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-mist/[0.03] p-4 text-[13px]">
                <div>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">Bransje</span>
                  <p className="mt-0.5">{companyInsight.matched.industry ?? "Ukjent"}</p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">Ansatte</span>
                  <p className="mt-0.5">{companyInsight.matched.employees ?? "Ukjent"}</p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                    Omsetning {companyInsight.matched.fiscalYear ? `(${companyInsight.matched.fiscalYear})` : ""}
                  </span>
                  <p className="mt-0.5">
                    {companyInsight.matched.revenue != null
                      ? formatMoney(companyInsight.matched.revenue)
                      : "Ukjent"}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">Resultat</span>
                  <p className="mt-0.5">
                    {companyInsight.matched.profit != null ? formatMoney(companyInsight.matched.profit) : "Ukjent"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-accent-soft/50 p-3">
                <p className="text-[12.5px] font-medium text-accent">{companyInsight.sizeTier.label}</p>
                <p className="text-[12.5px] text-ink-soft">{companyInsight.sizeTier.budgetHint}</p>
              </div>

              <p className="text-[13px] leading-relaxed text-ink-soft">{companyInsight.assessment}</p>
            </div>
          )}
        </section>
      )}

      {/* Timepris */}
      <section className="card flex items-center justify-between p-6">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Timepris</h2>
          <p className="text-[12.5px] text-ink-soft">Gjelder alle fase-radene under, eks. mva.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(Math.max(0, Number(e.target.value) || 0))}
            className="field !w-28 text-right tabular-nums"
          />
          <span className="text-[13px] text-ink-soft">kr/t</span>
        </div>
      </section>

      {/* Faserader */}
      <section className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">Faser</h2>
          <button
            onClick={() => setShowDays((v) => !v)}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              showDays ? "bg-accent-soft text-accent" : "bg-mist/[0.05] text-ink-soft hover:text-ink"
            }`}
          >
            {showDays ? "Skjul dager" : "Vis dager"}
          </button>
        </div>
        <div
          className={`mb-1 grid gap-3 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint ${
            showDays ? "grid-cols-[1.3fr_90px_90px_130px]" : "grid-cols-[1.6fr_100px_130px]"
          }`}
        >
          <span>Fase</span>
          <span className="text-right">Timer</span>
          {showDays && <span className="text-right">Dager</span>}
          <span className="text-right">Sum</span>
        </div>
        <div className="flex flex-col divide-y divide-line">
          {PHASES.map((p) => {
            const isPl = p.key === PL_KEY;
            const warning = !isPl ? phaseWarning(p.key, referenceProjects) : null;
            const days = Math.round((phaseHours[p.key] / HOURS_PER_DAY) * 100) / 100;
            return (
              <div key={p.key} className="py-2.5">
                <div
                  className={`grid items-center gap-3 ${
                    showDays ? "grid-cols-[1.3fr_90px_90px_130px]" : "grid-cols-[1.6fr_100px_130px]"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[13.5px]">
                    {p.label}
                    {warning && (
                      <span title={`${warning.name}: ${warning.estimert}t estimert → ${warning.faktisk}t brukt`}>
                        <TriangleAlert size={13} className="text-warning-ink" />
                      </span>
                    )}
                  </span>
                  {isPl ? (
                    <span className="text-right text-[13px] tabular-nums text-ink-soft">
                      {phaseHours[p.key]}
                    </span>
                  ) : (
                    <input
                      type="number"
                      step="0.5"
                      value={phaseHours[p.key]}
                      onChange={(e) => setHours(p.key, Number(e.target.value) || 0)}
                      className="field !py-1.5 text-right tabular-nums"
                    />
                  )}
                  {showDays &&
                    (isPl ? (
                      <span className="text-right text-[13px] tabular-nums text-ink-soft">{days}</span>
                    ) : (
                      <input
                        type="number"
                        step="0.1"
                        value={days}
                        onChange={(e) => setDays(p.key, Number(e.target.value) || 0)}
                        className="field !py-1.5 text-right tabular-nums"
                      />
                    ))}
                  <span className="text-right text-[13.5px] font-medium tabular-nums">
                    {formatMoney(Math.round(phaseHours[p.key] * hourlyRate))}
                  </span>
                </div>
                {isPl && (
                  <p className="mt-1 text-[11.5px] text-ink-faint">= 10 % av de andre fasene</p>
                )}
                {warning && (
                  <p className="mt-1 text-[11.5px] text-warning-ink">
                    ⚠ {warning.name} brukte {Math.round((warning.pct - 1) * 100)} % mer tid enn
                    estimert her ({warning.estimert}t → {warning.faktisk}t)
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {showDays && (
          <p className="mt-3 text-[11.5px] text-ink-faint">1 dag = {HOURS_PER_DAY} timer.</p>
        )}
      </section>

      {/* Egendefinerte rader */}
      <section className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">Andre rader</h2>
          <button onClick={addCustomRow} className="btn btn-ghost">
            <Plus size={14} />
            Legg til rad
          </button>
        </div>
        {customRows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Bruk dette til engangskostnader som ikke passer i fasene, f.eks. bilder eller lisenser.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {customRows.map((row) => (
              <div key={row.id} className="grid grid-cols-[1.6fr_130px_28px] items-center gap-3">
                <input
                  value={row.title}
                  onChange={(e) =>
                    setCustomRows((rows) =>
                      rows.map((r) => (r.id === row.id ? { ...r, title: e.target.value } : r))
                    )
                  }
                  placeholder="Beskrivelse"
                  className="field !py-1.5 text-[13.5px]"
                />
                <input
                  type="number"
                  value={row.price}
                  onChange={(e) =>
                    setCustomRows((rows) =>
                      rows.map((r) =>
                        r.id === row.id ? { ...r, price: Number(e.target.value) || 0 } : r
                      )
                    )
                  }
                  placeholder="Pris"
                  className="field !py-1.5 text-right tabular-nums"
                />
                <button
                  onClick={() => setCustomRows((rows) => rows.filter((r) => r.id !== row.id))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rabatt og totalsum */}
      <section className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">Rabatt</h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full bg-mist/[0.05] p-1">
              <button
                onClick={() => setDiscountType("percent")}
                className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition ${
                  discountType === "percent" ? "bg-surface shadow-card" : "text-ink-soft"
                }`}
              >
                %
              </button>
              <button
                onClick={() => setDiscountType("fixed")}
                className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition ${
                  discountType === "fixed" ? "bg-surface shadow-card" : "text-ink-soft"
                }`}
              >
                kr
              </button>
            </div>
            <input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))}
              className="field !w-24 text-right tabular-nums"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line pt-4 text-[13.5px]">
          <div className="flex justify-between text-ink-soft">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(Math.round(subtotal))}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-danger">
              <span>Rabatt</span>
              <span className="tabular-nums">−{formatMoney(Math.round(discountAmount))}</span>
            </div>
          )}
          <div className="flex justify-between text-[17px] font-semibold tracking-tight">
            <span>Total (eks. mva)</span>
            <span className="tabular-nums">{formatMoney(Math.round(total))}</span>
          </div>
          <div className="flex justify-between text-[12px] text-ink-faint">
            <span>Inkl. mva (25 %)</span>
            <span className="tabular-nums">{formatMoney(Math.round(totalWithVat))}</span>
          </div>
        </div>
      </section>

      {/* Lagre til deal */}
      <section className="card p-6">
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Lagre til deal</h2>

        {saveMessage && (
          <p
            className={`mb-3 rounded-xl px-4 py-2.5 text-[13px] font-medium ${
              saveMessage.ok ? "bg-success/10 text-success-ink" : "bg-danger/10 text-danger"
            }`}
          >
            {saveMessage.text}
          </p>
        )}

        {createdDeal ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5 rounded-xl bg-success/10 px-3 py-2.5">
              <CompanyLogo logoUrl={createdDeal.logoUrl} name={createdDeal.companyName} size={28} radius={8} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">{createdDeal.companyName}</p>
                <p className="text-[12px] text-success-ink">
                  Deal opprettet og estimat lagret.
                </p>
              </div>
              <Link
                href={`/leads/${createdDeal.id}`}
                className="shrink-0 text-[12.5px] font-medium text-accent hover:underline"
              >
                Åpne deal
              </Link>
            </div>
            <SendQuoteButton dealId={createdDeal.id} dealTitle={newDealTitle || "Ny deal"} contacts={[]} />
          </div>
        ) : (
          <>
            <div className="mb-4 flex rounded-full bg-mist/[0.05] p-1">
              {(["eksisterende", "ny"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSaveMode(m)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                    saveMode === m ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {m === "eksisterende" ? "Eksisterende deal" : "Ny deal"}
                </button>
              ))}
            </div>

            {saveMode === "eksisterende" ? (
              <>
                {selectedDeal ? (
                  <div className="mb-3 flex items-center gap-2.5 rounded-xl bg-accent-soft/60 px-3 py-2.5">
                    <CompanyLogo logoUrl={selectedDeal.logoUrl} name={selectedDeal.companyName} size={28} radius={8} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{selectedDeal.companyName}</p>
                      <p className="truncate text-[12px] text-ink-soft">{selectedDeal.title}</p>
                    </div>
                    <Link
                      href={`/leads/${selectedDeal.id}`}
                      className="shrink-0 text-[12.5px] font-medium text-accent hover:underline"
                    >
                      Åpne deal
                    </Link>
                    <button
                      onClick={() => setSelectedDealId("")}
                      className="shrink-0 text-[12.5px] font-medium text-ink-soft hover:text-ink"
                    >
                      Bytt
                    </button>
                  </div>
                ) : (
                  <div className="mb-3">
                    <div className="relative">
                      <Search
                        size={13}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                      />
                      <input
                        value={dealSearch}
                        onChange={(e) => setDealSearch(e.target.value)}
                        placeholder="Søk etter deal eller selskap …"
                        className="field !pl-8"
                      />
                    </div>
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {filteredDeals.map((d) => (
                        <li key={d.id}>
                          <button
                            onClick={() => setSelectedDealId(d.id)}
                            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-mist/[0.04]"
                          >
                            <CompanyLogo logoUrl={d.logoUrl} name={d.companyName} size={24} radius={7} />
                            <span className="min-w-0 flex-1 truncate text-[13px]">
                              <span className="font-medium">{d.companyName}</span>{" "}
                              <span className="text-ink-soft">· {d.title}</span>
                            </span>
                            <Check size={13} className="shrink-0 text-ink-faint opacity-0" />
                          </button>
                        </li>
                      ))}
                      {filteredDeals.length === 0 && (
                        <li className="px-2.5 py-2 text-[12.5px] text-ink-faint">Ingen treff.</li>
                      )}
                    </ul>
                  </div>
                )}

                {confirmingSave ? (
                  <div className="rounded-xl bg-warning/10 p-4">
                    <p className="mb-3 text-[13px] text-warning-ink">
                      Dette erstatter eksisterende varelinjer på {selectedDeal?.title ?? "dealen"} med
                      de {buildLines().length} radene over. Fortsette?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={confirmSave} disabled={savePending} className="btn btn-primary">
                        {savePending ? "Lagrer …" : "Ja, erstatt varelinjene"}
                      </button>
                      <button onClick={() => setConfirmingSave(false)} className="btn btn-secondary">
                        Avbryt
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingSave(true)}
                    disabled={!selectedDealId || buildLines().length === 0}
                    className="btn btn-primary"
                  >
                    Lagre {formatMoney(Math.round(total))} til dealen
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-xl bg-mist/[0.03] px-3 py-2 text-[12px] text-ink-soft">
                  <Building2 size={13} className="shrink-0" />
                  Søk i Brønnøysundregisteret, eller fyll inn manuelt.
                </div>

                <div className="flex rounded-full bg-mist/[0.05] p-1">
                  {(["brreg", "manuelt"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setNewCompanyMode(m);
                        setBrregSelected(null);
                      }}
                      className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                        newCompanyMode === m ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      {m === "brreg" ? "Søk i Brreg" : "Manuelt"}
                    </button>
                  ))}
                </div>

                {newCompanyMode === "brreg" ? (
                  brregSelected ? (
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
                        onClick={() => setBrregSelected(null)}
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
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          placeholder="Selskapsnavn"
                          className="field !pl-8"
                        />
                      </div>
                      {newCompanyName.trim().length >= 2 && (
                        <ul className="mt-1.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                          {brregHits.map((h) => (
                            <li key={h.orgNumber}>
                              <button
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
                            <li className="px-2.5 py-2 text-[12.5px] text-ink-faint">Søker i Brreg …</li>
                          )}
                        </ul>
                      )}
                    </div>
                  )
                ) : (
                  <>
                    <input
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      placeholder="Selskapsnavn"
                      className="field"
                    />
                    <input
                      value={newOrgNumber}
                      onChange={(e) => setNewOrgNumber(e.target.value)}
                      inputMode="numeric"
                      placeholder="Organisasjonsnummer (valgfritt)"
                      className="field"
                    />
                  </>
                )}

                <input
                  value={newDealTitle}
                  onChange={(e) => setNewDealTitle(e.target.value)}
                  placeholder="Hva gjelder dealen? (f.eks. Nettsider)"
                  className="field"
                />

                <button
                  onClick={createDeal}
                  disabled={
                    createPending ||
                    buildLines().length === 0 ||
                    (newCompanyMode === "brreg" ? !brregSelected : !newCompanyName.trim())
                  }
                  className="btn btn-primary"
                >
                  {createPending
                    ? "Oppretter …"
                    : `Opprett deal og lagre ${formatMoney(Math.round(total))}`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <ReferenceProjects items={referenceProjects} />
    </div>
  );
}
