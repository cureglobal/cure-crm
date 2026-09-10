"use client";

import { useState, useTransition } from "react";
import { upsertRecurringTarget, deleteRecurringTarget } from "@/lib/actions";
import { formatNumberInput } from "@/lib/format";
import { Trash2 } from "lucide-react";

export interface RecurringTargetRow {
  id: number;
  businessUnitId: number;
  businessUnitName: string;
  monthlyCostTarget: number;
}

function TargetRow({ target }: { target: RecurringTargetRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(formatNumberInput(target.monthlyCostTarget));

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("monthlyCostTarget", amount);
    startTransition(async () => {
      const res = await upsertRecurringTarget(target.businessUnitId, fd);
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-mist/[0.03] p-3">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {target.businessUnitName}
      </span>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
        inputMode="numeric"
        placeholder="0"
        className="field !w-32 !py-1.5 text-right text-[13px]"
      />
      <span className="text-[12px] text-ink-faint">kr/mnd</span>
      <button onClick={save} disabled={pending} className="btn btn-secondary !py-1 !text-[12px]">
        Lagre
      </button>
      <button
        onClick={() => startTransition(async () => { await deleteRecurringTarget(target.id); })}
        disabled={pending}
        title="Fjern målet"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
      {error && <p className="basis-full text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}

export default function RecurringTargetManager({
  targets,
  availableBusinessUnits,
}: {
  targets: RecurringTargetRow[];
  availableBusinessUnits: { id: number; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newBusinessUnitId, setNewBusinessUnitId] = useState(
    String(availableBusinessUnits[0]?.id ?? "")
  );
  const [newAmount, setNewAmount] = useState("");

  function addTarget() {
    setError(null);
    if (!newBusinessUnitId || !newAmount) return;
    const fd = new FormData();
    fd.set("monthlyCostTarget", newAmount);
    startTransition(async () => {
      const res = await upsertRecurringTarget(Number(newBusinessUnitId), fd);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setNewAmount("");
    });
  }

  return (
    <div>
      <h3 className="mb-1 text-[13.5px] font-semibold">Recurring-mål</h3>
      <p className="mb-3 text-[12px] text-ink-soft">
        Månedlig kostnadsmål per selskap — vist mot dagens faktiske recurring-inntekt (regnet
        automatisk fra vunnet-deals med recurring fakturering) på Statistikk-siden.
      </p>
      {targets.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {targets.map((t) => (
            <TargetRow key={t.id} target={t} />
          ))}
        </div>
      )}
      {availableBusinessUnits.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={newBusinessUnitId}
            onChange={(e) => setNewBusinessUnitId(e.target.value)}
            className="field !w-auto !py-1.5 text-[13px]"
          >
            {availableBusinessUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="Kostnadsmål (kr/mnd)"
            className="field !w-44 !py-1.5 text-[13px]"
          />
          <button
            onClick={addTarget}
            disabled={pending || !newAmount}
            className="btn btn-ghost !py-1.5 !text-[12.5px]"
          >
            + Nytt mål
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}
