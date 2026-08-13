"use client";

import { useRef, useTransition } from "react";
import { addDealLine, deleteDealLine, updateDealLine } from "@/lib/actions";
import { formatMoney } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";

export interface DealLineItem {
  id: number;
  title: string;
  hours: number;
  rate: number;
}

const SUGGESTIONS = ["Oppstartsworkshop", "Design", "Utvikling", "SEO", "Møter"];

function LineRow({ line, dealId }: { line: DealLineItem; dealId: number }) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    startTransition(async () => {
      await updateDealLine(line.id, dealId, data);
    });
  }

  return (
    <form
      ref={formRef}
      className={`group grid grid-cols-[1fr_76px_96px_100px_28px] items-center gap-2 ${
        pending ? "opacity-60" : ""
      }`}
    >
      <input
        name="title"
        defaultValue={line.title}
        onBlur={save}
        className="field !py-1.5 text-[13px]"
      />
      <input
        name="hours"
        defaultValue={line.hours}
        inputMode="decimal"
        onBlur={save}
        className="field !py-1.5 text-right text-[13px]"
      />
      <input
        name="rate"
        defaultValue={line.rate}
        inputMode="numeric"
        onBlur={save}
        className="field !py-1.5 text-right text-[13px]"
      />
      <span className="text-right text-[13px] font-medium tabular-nums">
        {formatMoney(Math.round(line.hours * line.rate))}
      </span>
      <button
        type="button"
        title="Fjern linje"
        onClick={() =>
          startTransition(async () => {
            await deleteDealLine(line.id, dealId);
          })
        }
        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </form>
  );
}

export default function DealLines({
  dealId,
  lines,
}: {
  dealId: number;
  lines: DealLineItem[];
}) {
  const [pending, startTransition] = useTransition();
  const addFormRef = useRef<HTMLFormElement>(null);
  const total = lines.reduce((acc, l) => acc + l.hours * l.rate, 0);

  return (
    <div>
      {lines.length > 0 && (
        <div className="mb-1 grid grid-cols-[1fr_76px_96px_100px_28px] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          <span>Fase</span>
          <span className="text-right">Timer</span>
          <span className="text-right">Timepris</span>
          <span className="text-right">Sum</span>
          <span />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {lines.map((line) => (
          <LineRow key={line.id} line={line} dealId={dealId} />
        ))}
      </div>

      {lines.length > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-[13px] font-medium text-ink-soft">
            {lines.reduce((acc, l) => acc + l.hours, 0).toLocaleString("nb-NO")} timer totalt
          </span>
          <span className="pr-[36px] text-[15px] font-semibold tabular-nums tracking-tight">
            {formatMoney(Math.round(total))}
          </span>
        </div>
      )}

      <form
        ref={addFormRef}
        action={async (data: FormData) => {
          startTransition(async () => {
            await addDealLine(dealId, data);
            addFormRef.current?.reset();
          });
        }}
        className="mt-4 border-t border-line pt-4"
      >
        <div className="grid grid-cols-[1fr_76px_96px] gap-2">
          <input
            name="title"
            required
            list="fase-forslag"
            placeholder="Fase (f.eks. Design)"
            className="field !py-1.5 text-[13px]"
          />
          <datalist id="fase-forslag">
            {SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input
            name="hours"
            required
            inputMode="decimal"
            placeholder="Timer"
            className="field !py-1.5 text-right text-[13px]"
          />
          <input
            name="rate"
            required
            inputMode="numeric"
            placeholder="Timepris"
            className="field !py-1.5 text-right text-[13px]"
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const input = addFormRef.current?.elements.namedItem(
                    "title"
                  ) as HTMLInputElement | null;
                  if (input) {
                    input.value = s;
                    input.focus();
                  }
                }}
                className="rounded-full bg-mist/[0.05] px-2.5 py-1 text-[11.5px] font-medium text-ink-soft transition hover:bg-mist/[0.08] hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
          <button type="submit" disabled={pending} className="btn btn-ghost shrink-0">
            <Plus size={14} />
            Legg til
          </button>
        </div>
      </form>
    </div>
  );
}
