"use client";

import { useState, useTransition } from "react";
import { updateSalesTarget, updateBusinessUnitTarget, upsertMonthlyActual } from "@/lib/actions";
import { formatMoney, formatNumberInput } from "@/lib/format";

const MONTH_LABELS = [
  "Januar",
  "Februar",
  "Mars",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export interface MonthlyActualRow {
  month: number; // 1–12
  amount: number | null;
}

export interface BusinessUnitTargetRow {
  businessUnitId: number;
  name: string;
  totalAmount: number;
  q1Weight: number;
  q2Weight: number;
  q3Weight: number;
  q4Weight: number;
}

function QuarterWeightInputs({
  weights,
  onChange,
}: {
  weights: { q1: number; q2: number; q3: number; q4: number };
  onChange: (weights: { q1: number; q2: number; q3: number; q4: number }) => void;
}) {
  const sum = weights.q1 + weights.q2 + weights.q3 + weights.q4;
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {(["q1", "q2", "q3", "q4"] as const).map((q, i) => (
          <label key={q} className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint">Q{i + 1}</span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                value={weights[q]}
                onChange={(e) => onChange({ ...weights, [q]: Number(e.target.value) })}
                className="field !py-1.5 text-[13px]"
              />
              <span className="text-[12px] text-ink-faint">%</span>
            </span>
          </label>
        ))}
      </div>
      <p className={`mt-1.5 text-[11.5px] ${sum === 100 ? "text-ink-faint" : "text-danger"}`}>
        Sum: {sum} %
      </p>
    </div>
  );
}

function BusinessUnitRow({ unit, year }: { unit: BusinessUnitTargetRow; year: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(formatNumberInput(unit.totalAmount));
  const [weights, setWeights] = useState({
    q1: unit.q1Weight,
    q2: unit.q2Weight,
    q3: unit.q3Weight,
    q4: unit.q4Weight,
  });
  const weightSum = weights.q1 + weights.q2 + weights.q3 + weights.q4;

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("totalAmount", total);
    fd.set("q1Weight", String(weights.q1));
    fd.set("q2Weight", String(weights.q2));
    fd.set("q3Weight", String(weights.q3));
    fd.set("q4Weight", String(weights.q4));
    startTransition(async () => {
      const res = await updateBusinessUnitTarget(year, unit.businessUnitId, fd);
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <div className="rounded-xl bg-mist/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{unit.name}</span>
        <input
          value={total}
          onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="0"
          className="field !w-36 !py-1.5 text-right text-[13px]"
        />
      </div>
      <QuarterWeightInputs weights={weights} onChange={setWeights} />
      {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
      <button
        onClick={save}
        disabled={pending || weightSum !== 100}
        className="btn btn-secondary mt-2 !py-1 !text-[12px]"
      >
        Lagre
      </button>
    </div>
  );
}

export default function SalesTargetManager({
  year,
  totalAmount,
  q1Weight,
  q2Weight,
  q3Weight,
  q4Weight,
  monthlyActuals,
  businessUnitTargets,
}: {
  year: number;
  totalAmount: number;
  q1Weight: number;
  q2Weight: number;
  q3Weight: number;
  q4Weight: number;
  monthlyActuals: MonthlyActualRow[];
  businessUnitTargets: BusinessUnitTargetRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [total, setTotal] = useState(formatNumberInput(totalAmount));
  const [weights, setWeights] = useState({ q1: q1Weight, q2: q2Weight, q3: q3Weight, q4: q4Weight });
  const weightSum = weights.q1 + weights.q2 + weights.q3 + weights.q4;

  function saveTarget() {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("totalAmount", total);
    fd.set("q1Weight", String(weights.q1));
    fd.set("q2Weight", String(weights.q2));
    fd.set("q3Weight", String(weights.q3));
    fd.set("q4Weight", String(weights.q4));
    startTransition(async () => {
      const res = await updateSalesTarget(year, fd);
      if (res.ok) setMessage(res.message);
      else setError(res.message);
    });
  }

  function saveMonth(month: number, value: string) {
    const fd = new FormData();
    fd.set("amount", value);
    startTransition(() => upsertMonthlyActual(year, month, fd));
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] text-danger">{error}</p>
      )}
      {message && !error && (
        <p className="mb-3 rounded-xl bg-success/10 px-4 py-2.5 text-[13px] text-success-ink">
          {message}
        </p>
      )}

      <div className="mb-4">
        <label className="mb-1 block text-[12px] font-medium text-ink-soft">
          Årsmål {year}
        </label>
        <input
          value={total}
          onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="14 000 000"
          className="field !w-48"
        />
      </div>

      <div className="mb-2">
        <p className="mb-1.5 text-[12px] font-medium text-ink-soft">
          Fordeling på kvartal (må summere til 100 %)
        </p>
        <QuarterWeightInputs weights={weights} onChange={setWeights} />
      </div>

      <button
        onClick={saveTarget}
        disabled={pending || weightSum !== 100}
        className="btn btn-secondary"
      >
        Lagre salgsmål
      </button>

      {businessUnitTargets.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-1 text-[13.5px] font-semibold">Salgsmål per selskap</h3>
          <p className="mb-3 text-[12px] text-ink-soft">
            Egen fordeling per selskap — trenger ikke summere til årsmålet over, men bør
            normalt gjøre det.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {businessUnitTargets.map((u) => (
              <BusinessUnitRow key={u.businessUnitId} unit={u} year={year} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="mb-1 text-[13.5px] font-semibold">Faktisk salg per måned</h3>
        <p className="mb-3 text-[12px] text-ink-soft">
          Manuelt innlagt historikk fra et annet CRM-system. Måneder du ikke fyller inn her
          regnes automatisk ut fra vunnet-deals i denne appen — tøm feltet for å gå tilbake til
          det.
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {MONTH_LABELS.map((label, i) => {
            const month = i + 1;
            const row = monthlyActuals.find((m) => m.month === month);
            return (
              <label key={month} className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] text-ink-soft">{label}</span>
                <input
                  defaultValue={row?.amount != null ? formatNumberInput(row.amount) : ""}
                  onBlur={(e) => saveMonth(month, e.target.value)}
                  inputMode="numeric"
                  placeholder="—"
                  className="field !w-28 !py-1 text-right text-[12.5px]"
                />
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-[11.5px] text-ink-faint">
          Sum innlagt: {formatMoney(monthlyActuals.reduce((acc, m) => acc + (m.amount ?? 0), 0))}
        </p>
      </div>
    </div>
  );
}
