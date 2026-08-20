"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  importCompanies,
  importPeople,
  importProductiveDeals,
  type ImportCompanyRow,
  type ImportDealRow,
  type ImportDealResult,
  type ImportPersonRow,
} from "@/lib/actions";
import { parseCsv, findColumn, cell, parseNumber, parseDate } from "@/lib/csv";
import { firstStageId, type Stage } from "@/lib/stages";
import { formatMoney } from "@/lib/format";
import {
  Upload,
  X,
  FileSpreadsheet,
  Columns3,
  Building2,
  Contact,
  Check,
} from "lucide-react";

type Kind = "deals" | "bedrifter" | "personer";

const TABS: { id: Kind; label: string; icon: React.ReactNode; columns: string }[] = [
  {
    id: "deals",
    label: "Deals",
    icon: <Columns3 size={14} />,
    columns: "Selskap, Deal, Verdi, Dato, Kommentar, Fase — eller en Productive-eksport",
  },
  {
    id: "bedrifter",
    label: "Bedrifter",
    icon: <Building2 size={14} />,
    columns: "Navn, Org.nr, Nettside, Telefon",
  },
  {
    id: "personer",
    label: "Personer",
    icon: <Contact size={14} />,
    columns: "Navn, E-post, Telefon, Selskap, Rolle",
  },
];

interface Parsed {
  kind: Kind;
  fileName: string;
  deals: (ImportDealRow & { productiveStage: string })[];
  companies: ImportCompanyRow[];
  people: ImportPersonRow[];
  stageMap: Record<string, string>;
  count: number;
}

// Fasene er nå fritt redigerbare, så vi kan ikke lenger matche på faste
// nøkler — forsøker først å matche direkte mot fasenavnet, så noen vanlige
// nøkkelord, og faller ellers tilbake på den første fasen i rekkefølgen.
function guessStage(value: string, stages: Stage[]): string {
  const s = value.toLowerCase();
  if (stages.length === 0) return "";

  const direct = stages.find(
    (st) => s.includes(st.label.toLowerCase()) || st.label.toLowerCase().includes(s)
  );
  if (direct) return String(direct.id);

  const byKeyword = (...kws: string[]) =>
    stages.find((st) => kws.some((k) => st.label.toLowerCase().includes(k)));

  const won = stages.find((st) => st.isWon);
  if (won && (s.includes("vunnet") || s.includes("won") || s.includes("signert"))) {
    return String(won.id);
  }
  const lost = stages.find((st) => st.isLost);
  if (lost && (s.includes("tapt") || s.includes("lost"))) return String(lost.id);

  const sendt = byKeyword("tilbud sendt", "anbud", "kontrakt", "signering");
  if (sendt && (s.includes("sendt") || s.includes("anbud") || s.includes("kontrakt") || s.includes("signering"))) {
    return String(sendt.id);
  }
  const dialog = byKeyword("møt", "dialog", "oppfølging", "tilbud");
  if (dialog && (s.includes("møt") || s.includes("dialog") || s.includes("tilbud"))) {
    return String(dialog.id);
  }
  const kontakt = byKeyword("kontakt");
  if (kontakt && s.includes("kontakt")) return String(kontakt.id);

  return firstStageId(stages);
}

export default function ImportDialog({
  collapsed,
  stages,
  pipelines,
}: {
  collapsed?: boolean;
  stages: Stage[];
  pipelines: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("deals");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? 1);
  const pipelineStages = useMemo(
    () => stages.filter((s) => s.pipelineId === pipelineId),
    [stages, pipelineId]
  );
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [dealResults, setDealResults] = useState<ImportDealResult[] | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function reset() {
    setParsed(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    setOpen(false);
    reset();
    setResult(null);
    setDealResults(null);
  }

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setDealResults(null);
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setError("Fant ingen rader i fila.");
      return;
    }
    const header = rows[0];
    const body = rows.slice(1);

    if (kind === "deals") {
      const stageIdx = findColumn(header, "stage", "fase");
      // Selskap: en eksplisitt klient/selskap-kolonne er alltid sikrest.
      // Enkelte eksporter (f.eks. Productive med en egen "Client"-kolonne)
      // bruker "Name" til DEALENS navn, ikke selskapet — da må "Client"/
      // "Selskap"/"Company" sjekkes først, ellers leser vi dealnavnet som
      // om det var selskapet på hver eneste rad.
      const clientOrCompanyIdx = findColumn(header, "client", "kunde", "selskap", "company");
      const genericNameIdx = findColumn(header, "name", "navn");
      const nameIdx = clientOrCompanyIdx !== -1 ? clientOrCompanyIdx : genericNameIdx;

      // Dealnavn: en eksplisitt dealkolonne er sikrest. Har selskapet
      // allerede funnet sin EGEN klient/selskap-kolonne over, er "Name"/
      // "Navn" fri til å bety dealens eget navn i stedet for å bli brukt
      // til selskapet på nytt.
      const explicitDealIdx = findColumn(header, "deal", "dealnavn", "tittel", "title");
      const dealIdx =
        explicitDealIdx !== -1
          ? explicitDealIdx
          : clientOrCompanyIdx !== -1 && genericNameIdx !== -1
            ? genericNameIdx
            : -1;

      const valueIdx = findColumn(header, "budget total", "verdi", "value", "budget", "sum");
      const dateIdx = findColumn(header, "next action", "dato", "date", "oppfølging");
      const commentIdx = findColumn(header, "kommentar", "comment", "notat");

      if (nameIdx === -1) {
        setError("Fant ingen kolonne for selskap. Forventer «Client», «Selskap» eller «Name».");
        return;
      }

      const deals: (ImportDealRow & { productiveStage: string })[] = [];
      for (const r of body) {
        const raw = cell(r, nameIdx);
        if (!raw) continue; // Productive har gruppelinjer med tomt navn
        // Productive skriver «Selskap - Dealnavn» i én kolonne når det ikke
        // finnes en egen dealkolonne.
        let companyName = raw;
        let dealTitle = cell(r, dealIdx);
        if (!dealTitle) {
          const dash = raw.indexOf(" - ");
          if (dash > 0) {
            companyName = raw.slice(0, dash).trim();
            dealTitle = raw.slice(dash + 3).trim();
          } else {
            dealTitle = "Deal";
          }
        }
        const value = parseNumber(cell(r, valueIdx));
        deals.push({
          companyName,
          dealTitle,
          stage: firstStageId(pipelineStages),
          value: value && value > 0 ? Math.round(value) : null,
          followUpAt: parseDate(cell(r, dateIdx)),
          comment: cell(r, commentIdx) || null,
          productiveStage: cell(r, stageIdx),
        });
      }
      if (deals.length === 0) {
        setError("Fant ingen deals i fila.");
        return;
      }
      const stageMap: Record<string, string> = {};
      for (const d of deals) {
        if (!(d.productiveStage in stageMap)) {
          stageMap[d.productiveStage] = guessStage(d.productiveStage, pipelineStages);
        }
      }
      setParsed({
        kind,
        fileName: file.name,
        deals,
        companies: [],
        people: [],
        stageMap,
        count: deals.length,
      });
      return;
    }

    if (kind === "bedrifter") {
      const nameIdx = findColumn(header, "navn", "name", "selskap", "company", "firma");
      const orgIdx = findColumn(header, "orgnr", "org nr", "organisasjonsnummer", "org number");
      const siteIdx = findColumn(header, "nettside", "website", "web", "url", "hjemmeside");
      const phoneIdx = findColumn(header, "telefon", "phone", "tlf", "mobil");

      if (nameIdx === -1) {
        setError("Fant ingen kolonne for navn. Forventer «Navn» eller «Name».");
        return;
      }
      const list: ImportCompanyRow[] = [];
      for (const r of body) {
        const name = cell(r, nameIdx);
        if (!name) continue;
        list.push({
          name,
          orgNumber: cell(r, orgIdx) || null,
          website: cell(r, siteIdx) || null,
          phone: cell(r, phoneIdx) || null,
        });
      }
      if (list.length === 0) {
        setError("Fant ingen bedrifter i fila.");
        return;
      }
      setParsed({
        kind,
        fileName: file.name,
        deals: [],
        companies: list,
        people: [],
        stageMap: {},
        count: list.length,
      });
      return;
    }

    const nameIdx = findColumn(header, "navn", "name", "fullt navn", "kontakt");
    const emailIdx = findColumn(header, "e-post", "epost", "email", "mail");
    const phoneIdx = findColumn(header, "telefon", "phone", "tlf", "mobil");
    const companyIdx = findColumn(header, "selskap", "company", "firma", "bedrift");
    const roleIdx = findColumn(header, "rolle", "role", "tittel", "stilling");

    if (nameIdx === -1 && emailIdx === -1) {
      setError("Fant verken navn- eller e-postkolonne.");
      return;
    }
    const list: ImportPersonRow[] = [];
    for (const r of body) {
      const email = cell(r, emailIdx);
      const name = cell(r, nameIdx) || email.split("@")[0];
      if (!name) continue;
      list.push({
        name,
        email: email || null,
        phone: cell(r, phoneIdx) || null,
        companyName: cell(r, companyIdx) || null,
        role: cell(r, roleIdx) || null,
      });
    }
    if (list.length === 0) {
      setError("Fant ingen personer i fila.");
      return;
    }
    setParsed({
      kind,
      fileName: file.name,
      deals: [],
      companies: [],
      people: list,
      stageMap: {},
      count: list.length,
    });
  }

  function runImport() {
    if (!parsed) return;
    startTransition(async () => {
      if (parsed.kind === "deals") {
        const res = await importProductiveDeals(
          parsed.deals.map((d) => ({
            companyName: d.companyName,
            dealTitle: d.dealTitle,
            stage: parsed.stageMap[d.productiveStage] ?? firstStageId(pipelineStages),
            value: d.value,
            followUpAt: d.followUpAt,
            comment: d.comment,
          })),
          pipelineId
        );
        setResult(
          `Importerte ${res.imported} deals og ${res.companiesCreated} nye selskaper.` +
            (res.skipped > 0 ? ` ${res.skipped} hoppet over.` : "")
        );
        setDealResults(res.results);
      } else if (parsed.kind === "bedrifter") {
        const res = await importCompanies(parsed.companies);
        setResult(
          `Opprettet ${res.created} bedrifter, ${res.verified} ble bekreftet mot Enhetsregisteret.` +
            (res.skipped > 0 ? ` ${res.skipped} fantes fra før.` : "")
        );
      } else {
        const res = await importPeople(parsed.people);
        setResult(
          `Opprettet ${res.created} personer og ${res.linked} selskapskoblinger.` +
            (res.companiesCreated > 0 ? ` ${res.companiesCreated} nye selskaper.` : "") +
            (res.skipped > 0 ? ` ${res.skipped} fantes fra før.` : "")
        );
      }
      reset();
    });
  }

  const activeTab = TABS.find((t) => t.id === kind)!;

  // Sidebaren har backdrop-blur, som lager en ny referanseramme for
  // position: fixed. Modalen må derfor rendres utenfor den, via en portal.
  // `open` blir bare sann etter et klikk, så dette skjer alltid i nettleseren.
  const dialog = open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 py-[10vh] backdrop-blur-[2px]"
          onClick={close}
        >
          <div
            className="card w-full max-w-lg p-6 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Importer fra CSV</h2>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  Kolonnenavn gjenkjennes automatisk, på norsk eller engelsk.
                </p>
              </div>
              <button
                onClick={close}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mb-4 flex rounded-full bg-mist/[0.05] p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setKind(t.id);
                    reset();
                    setResult(null);
                    setDealResults(null);
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                    kind === t.id ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {kind === "deals" && pipelines.length > 1 && (
              <label className="mb-3 block text-[12px] font-medium text-ink-soft">
                Pipeline
                <select
                  value={pipelineId}
                  onChange={(e) => setPipelineId(Number(e.target.value))}
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

            {result && (
              <p className="mb-3 rounded-xl bg-success/10 px-4 py-2.5 text-[13px] font-medium text-success-ink">
                {result}
              </p>
            )}
            {dealResults && dealResults.length > 0 && (
              <div className="mb-3 rounded-xl border border-line">
                <div className="grid grid-cols-[1.2fr_1.2fr_1fr] gap-3 border-b border-line bg-mist/[0.03] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  <span>Selskap</span>
                  <span>Deal</span>
                  <span>Status</span>
                </div>
                <ul className="max-h-72 overflow-y-auto">
                  {dealResults.map((r, i) => (
                    <li
                      key={i}
                      className="grid grid-cols-[1.2fr_1.2fr_1fr] items-center gap-3 border-b border-line px-4 py-2 text-[12.5px] last:border-b-0"
                    >
                      <span className="truncate">{r.companyName}</span>
                      <span className="truncate text-ink-soft">{r.dealTitle}</span>
                      {r.status === "imported" ? (
                        <span className="flex items-center gap-1 text-success-ink">
                          <Check size={12} />
                          Importert
                        </span>
                      ) : (
                        <span className="truncate text-ink-faint" title={r.reason}>
                          {r.reason ?? "Hoppet over"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && (
              <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
                {error}
              </p>
            )}

            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />

            {!parsed ? (
              <div>
                <p className="mb-3 rounded-xl bg-mist/[0.03] px-4 py-3 text-[12.5px] text-ink-soft">
                  <span className="font-medium text-ink">Kolonner:</span> {activeTab.columns}
                </p>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) onFile(f);
                  }}
                  className={`rounded-xl border-2 border-dashed p-5 text-center transition ${
                    dragActive ? "border-accent bg-accent-soft/60" : "border-line"
                  }`}
                >
                  <p className="mb-3 text-[12.5px] text-ink-soft">
                    Dra og slipp CSV-filen hit, eller
                  </p>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="btn btn-primary w-full py-2.5"
                  >
                    <Upload size={14} />
                    Velg CSV-fil …
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2.5 rounded-xl bg-mist/[0.03] px-4 py-3">
                  <FileSpreadsheet size={16} className="shrink-0 text-ink-soft" />
                  <span className="flex-1 truncate text-[13px] font-medium">
                    {parsed.fileName}
                  </span>
                  <span className="shrink-0 text-[12.5px] text-ink-soft">
                    {parsed.count} rader
                  </span>
                  <button
                    onClick={reset}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
                  >
                    <X size={14} />
                  </button>
                </div>

                {parsed.kind === "deals" && Object.keys(parsed.stageMap).length > 0 && (
                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold">Fasemapping</h3>
                    <div className="flex flex-col gap-1.5">
                      {Object.keys(parsed.stageMap).map((ps) => (
                        <div key={ps} className="grid grid-cols-2 items-center gap-3">
                          <span className="truncate text-[13px] text-ink-soft" title={ps}>
                            {ps || "(uten fase)"}
                            <span className="ml-1.5 text-ink-faint">
                              {parsed.deals.filter((d) => d.productiveStage === ps).length}
                            </span>
                          </span>
                          <select
                            value={parsed.stageMap[ps]}
                            onChange={(e) =>
                              setParsed({
                                ...parsed,
                                stageMap: {
                                  ...parsed.stageMap,
                                  [ps]: e.target.value,
                                },
                              })
                            }
                            className="field !py-1.5 text-[13px]"
                          >
                            {pipelineStages.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-[13px] font-semibold">Forhåndsvisning</h3>
                  <ul className="flex flex-col gap-1 rounded-xl border border-line p-3">
                    {parsed.kind === "deals" &&
                      parsed.deals.slice(0, 5).map((d, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                          <span className="font-medium">{d.companyName}</span>
                          <span className="truncate text-ink-soft">· {d.dealTitle}</span>
                          {d.value ? (
                            <span className="ml-auto shrink-0 tabular-nums text-ink-soft">
                              {formatMoney(d.value)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    {parsed.kind === "bedrifter" &&
                      parsed.companies.slice(0, 5).map((c, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                          <span className="font-medium">{c.name}</span>
                          <span className="truncate text-ink-soft">
                            {[c.orgNumber, c.website].filter(Boolean).join(" · ")}
                          </span>
                        </li>
                      ))}
                    {parsed.kind === "personer" &&
                      parsed.people.slice(0, 5).map((p, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                          <span className="font-medium">{p.name}</span>
                          <span className="truncate text-ink-soft">
                            {[p.email, p.companyName].filter(Boolean).join(" · ")}
                          </span>
                        </li>
                      ))}
                    {parsed.count > 5 && (
                      <li className="text-[12px] text-ink-faint">
                        … og {parsed.count - 5} til
                      </li>
                    )}
                  </ul>
                </div>

                <button
                  onClick={runImport}
                  disabled={pending}
                  className="btn btn-primary w-full py-2.5"
                >
                  {pending ? (
                    "Importerer …"
                  ) : (
                    <>
                      <Check size={14} />
                      Importer {parsed.count} {activeTab.label.toLowerCase()}
                    </>
                  )}
                </button>
                {parsed.kind === "bedrifter" && (
                  <p className="-mt-2 text-[12px] text-ink-faint">
                    Bedrifter slås automatisk opp i Enhetsregisteret etter import.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
  ) : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`group relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium text-ink-soft transition hover:bg-mist/[0.04] hover:text-ink ${
          collapsed ? "justify-center" : "w-full"
        }`}
      >
        <Upload size={17} strokeWidth={1.8} />
        {!collapsed && "Importer"}
        {collapsed && (
          <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-chip-dark px-2 py-1 text-[12px] font-medium text-white opacity-0 shadow-card transition-opacity duration-100 group-hover:opacity-100">
            Importer
          </span>
        )}
      </button>
      {dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
