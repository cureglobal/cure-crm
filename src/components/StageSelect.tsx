"use client";

import { useMemo, useState, useTransition } from "react";
import type { Stage } from "@/lib/stages";
import { updateDealStage } from "@/lib/actions";
import { celebrateWin } from "@/components/WonCelebration";
import { Search, ChevronDown } from "lucide-react";

export default function StageSelect({
  dealId,
  stage,
  dealName,
  stages,
}: {
  dealId: number;
  stage: string;
  dealName?: string;
  stages: Stage[];
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = stages.find((s) => String(s.id) === stage);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stages;
    return stages.filter((s) => s.label.toLowerCase().includes(q));
  }, [stages, query]);

  function choose(s: Stage) {
    const sId = String(s.id);
    if (s.isWon && stage !== sId) celebrateWin(dealName);
    setOpen(false);
    setQuery("");
    startTransition(async () => {
      await updateDealStage(dealId, sId);
    });
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-mist/[0.05] px-3.5 py-2 text-[13px] font-medium transition hover:bg-mist/[0.08]"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: current?.color ?? "#8e8e93" }}
        />
        {current?.label ?? "Velg fase"}
        <ChevronDown size={14} className="text-ink-faint" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-line bg-surface p-2 shadow-pop">
            <div className="relative mb-1.5">
              <Search
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                placeholder="Søk etter fase …"
                className="field !py-1.5 !pl-7 text-[12.5px]"
              />
            </div>
            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {filtered.map((s) => {
                const sId = String(s.id);
                const active = sId === stage;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => choose(s)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition ${
                        active ? "bg-accent-soft font-medium text-accent" : "hover:bg-mist/[0.05]"
                      }`}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: s.color }}
                      />
                      {s.label}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-2.5 py-2 text-[12px] text-ink-faint">Ingen faser matcher.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
