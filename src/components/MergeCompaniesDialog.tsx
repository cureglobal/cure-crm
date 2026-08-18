"use client";

import { useMemo, useState } from "react";
import { X, GitMerge } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { formatOrgNumber } from "@/components/CompanyFacts";
import type { MergeCandidate } from "@/lib/actions";

type FieldKey =
  | "name"
  | "orgName"
  | "orgNumber"
  | "ownerId"
  | "businessUnitId"
  | "primaryContactId"
  | "website"
  | "phone"
  | "address"
  | "postalCode"
  | "city"
  | "employees"
  | "industry"
  | "ceoName"
  | "revenue"
  | "profit"
  | "fiscalYear";

const FIELDS: { key: FieldKey; label: string; format: (c: MergeCandidate) => string }[] = [
  { key: "name", label: "Navn", format: (c) => c.name },
  { key: "orgName", label: "Org. navn", format: (c) => c.orgName ?? "" },
  { key: "orgNumber", label: "Organisasjonsnummer", format: (c) => formatOrgNumber(c.orgNumber) },
  { key: "ownerId", label: "Eier av kunden", format: (c) => c.ownerName ?? "" },
  { key: "businessUnitId", label: "Vårt selskap", format: (c) => c.businessUnitName ?? "" },
  { key: "primaryContactId", label: "Hovedkontakt", format: (c) => c.primaryContactName ?? "" },
  { key: "website", label: "Nettside", format: (c) => c.website ?? "" },
  { key: "phone", label: "Telefon", format: (c) => c.phone ?? "" },
  { key: "address", label: "Adresse", format: (c) => c.address ?? "" },
  { key: "postalCode", label: "Postnummer", format: (c) => c.postalCode ?? "" },
  { key: "city", label: "Sted", format: (c) => c.city ?? "" },
  { key: "employees", label: "Ansatte", format: (c) => (c.employees != null ? String(c.employees) : "") },
  { key: "industry", label: "Bransje", format: (c) => c.industry ?? "" },
  { key: "ceoName", label: "Daglig leder", format: (c) => c.ceoName ?? "" },
  { key: "revenue", label: "Omsetning", format: (c) => (c.revenue != null ? formatMoney(c.revenue) : "") },
  { key: "profit", label: "Resultat", format: (c) => (c.profit != null ? formatMoney(c.profit) : "") },
  { key: "fiscalYear", label: "Regnskapsår", format: (c) => c.fiscalYear ?? "" },
];

function rawValue(c: MergeCandidate, key: FieldKey): unknown {
  return c[key];
}

interface Conflict {
  field: FieldKey;
  label: string;
  options: { sourceId: number; display: string; companyNames: string[] }[];
}

export default function MergeCompaniesDialog({
  candidates,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  candidates: MergeCandidate[];
  pending?: boolean;
  error?: string | null;
  onConfirm: (keepId: number, mergeIds: number[], overrides: Record<string, number>) => void;
  onCancel: () => void;
}) {
  const [keepId, setKeepId] = useState(candidates[0]?.id ?? 0);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);

  const nameById = useMemo(() => new Map(candidates.map((c) => [c.id, c.name])), [candidates]);

  // Felt med nøyaktig én ikke-tom verdi blant selskapene fylles automatisk
  // inn (dekker "hull" der hovedselskapet mangler noe de andre har) — bare
  // felt med to eller flere ULIKE ikke-tomme verdier vises som et valg.
  const { conflicts, autoFills } = useMemo(() => {
    const result: Conflict[] = [];
    const auto: Record<string, number> = {};
    for (const f of FIELDS) {
      const bySourceId = new Map<unknown, number[]>();
      for (const c of candidates) {
        const v = rawValue(c, f.key);
        if (v == null || v === "") continue;
        const key = v;
        if (!bySourceId.has(key)) bySourceId.set(key, []);
        bySourceId.get(key)!.push(c.id);
      }
      if (bySourceId.size === 0) continue; // ingen har verdi
      if (bySourceId.size === 1) {
        const [ids] = [...bySourceId.values()];
        if (!ids.includes(keepId)) auto[f.key] = ids[0];
        continue;
      }
      const options = [...bySourceId.entries()].map(([, ids]) => {
        const sourceId = ids[0];
        const source = candidates.find((c) => c.id === sourceId)!;
        return {
          sourceId,
          display: f.format(source),
          companyNames: ids.map((id) => nameById.get(id) ?? "?"),
        };
      });
      result.push({ field: f.key, label: f.label, options });
    }
    return { conflicts: result, autoFills: auto };
  }, [candidates, nameById, keepId]);

  function pickFor(field: FieldKey, sourceId: number) {
    setPicks((prev) => ({ ...prev, [field]: sourceId }));
  }

  function currentPick(conflict: Conflict): number {
    const explicit = picks[conflict.field];
    if (explicit != null && conflict.options.some((o) => o.sourceId === explicit)) return explicit;
    // Standard: hovedselskapets egen verdi hvis den er blant alternativene, ellers første.
    const keepOption = conflict.options.find((o) => o.sourceId === keepId);
    return (keepOption ?? conflict.options[0]).sourceId;
  }

  function confirm() {
    const overrides: Record<string, number> = { ...autoFills };
    for (const conflict of conflicts) {
      overrides[conflict.field] = currentPick(conflict);
    }
    const mergeIds = candidates.map((c) => c.id).filter((id) => id !== keepId);
    onConfirm(keepId, mergeIds, overrides);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 py-[8vh] backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-lg p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
              <GitMerge size={15} />
            </span>
            <h2 className="text-lg font-semibold tracking-tight">
              Slå sammen {candidates.length} selskaper
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
          Hvilket selskap skal beholdes?
        </label>
        <div className="mb-4 flex flex-col gap-1.5">
          {candidates.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition ${
                keepId === c.id ? "border-accent bg-accent-soft/40" : "border-line hover:bg-mist/[0.03]"
              }`}
            >
              <input
                type="radio"
                name="keepId"
                checked={keepId === c.id}
                onChange={() => setKeepId(c.id)}
                className="h-3.5 w-3.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.name}</span>
                <span className="block truncate text-[11.5px] text-ink-faint">
                  {c.orgNumber ? formatOrgNumber(c.orgNumber) : "Ikke bekreftet org.nr"} ·{" "}
                  {c.dealCount} deals · {c.peopleCount} personer
                </span>
              </span>
            </label>
          ))}
        </div>

        {conflicts.length > 0 && (
          <div className="mb-4 flex flex-col gap-3 border-t border-line pt-4">
            <p className="text-[12.5px] font-medium text-ink-soft">
              Disse feltene er ulike — velg hvilken verdi som skal gjelde:
            </p>
            {conflicts.map((conflict) => (
              <div key={conflict.field}>
                <p className="mb-1 text-[11.5px] font-medium text-ink-faint">{conflict.label}</p>
                <div className="flex flex-col gap-1">
                  {conflict.options.map((o) => (
                    <label
                      key={o.sourceId}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] hover:bg-mist/[0.04]"
                    >
                      <input
                        type="radio"
                        name={`field-${conflict.field}`}
                        checked={currentPick(conflict) === o.sourceId}
                        onChange={() => pickFor(conflict.field, o.sourceId)}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {o.display || <span className="text-ink-faint">(tomt)</span>}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {o.companyNames.join(", ")}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mb-3 text-[12px] text-ink-faint">
          Alle deals, personer, e-poster og kontakthistorikk flyttes til{" "}
          <span className="font-medium text-ink">{nameById.get(keepId)}</span>. De andre selskapene
          slettes. Dette kan ikke angres.
        </p>

        {error && <p className="mb-3 text-[12.5px] text-danger">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">
            Avbryt
          </button>
          {confirming ? (
            <button
              onClick={confirm}
              disabled={pending}
              className="btn btn-danger flex-1"
              autoFocus
            >
              {pending ? "Slår sammen …" : "Ja, slå sammen"}
            </button>
          ) : (
            <button onClick={() => setConfirming(true)} className="btn btn-primary flex-1">
              Slå sammen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
