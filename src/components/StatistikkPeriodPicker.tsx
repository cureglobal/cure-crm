"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CalendarPopover, { toDateStr } from "@/components/CalendarPopover";

const PERIODS: { key: "30" | "kvartal" | "ar"; label: string }[] = [
  { key: "30", label: "Siste 30 dager" },
  { key: "kvartal", label: "Siste kvartal" },
  { key: "ar", label: "I år" },
];

function defaultCustomRange() {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { fra: toDateStr(from), til: toDateStr(now) };
}

export default function StatistikkPeriodPicker({
  periode,
  fra,
  til,
}: {
  periode: "30" | "kvartal" | "ar" | "egendefinert";
  fra: string;
  til: string;
}) {
  const router = useRouter();
  const [fraOpen, setFraOpen] = useState(false);
  const [tilOpen, setTilOpen] = useState(false);

  function goPeriode(key: string) {
    router.push(`/statistikk?periode=${key}`);
  }

  function goCustom(newFra: string, newTil: string) {
    router.push(`/statistikk?periode=egendefinert&fra=${newFra}&til=${newTil}`);
  }

  function openCustom() {
    if (periode === "egendefinert") return;
    const d = defaultCustomRange();
    goCustom(d.fra, d.til);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex rounded-full bg-mist/[0.05] p-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => goPeriode(p.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
              periode === p.key ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={openCustom}
          className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
            periode === "egendefinert" ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
          }`}
        >
          Egendefinert
        </button>
      </div>

      {periode === "egendefinert" && (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-soft">
          <span>Fra</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setTilOpen(false);
                setFraOpen((v) => !v);
              }}
              className="field !w-auto !py-1 text-[12.5px]"
            >
              {fra || "Velg dato"}
            </button>
            {fraOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setFraOpen(false)} />
                <CalendarPopover
                  value={fra}
                  onChoose={(d) => {
                    setFraOpen(false);
                    goCustom(d, til || d);
                  }}
                />
              </>
            )}
          </div>
          <span>til</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setFraOpen(false);
                setTilOpen((v) => !v);
              }}
              className="field !w-auto !py-1 text-[12.5px]"
            >
              {til || "Velg dato"}
            </button>
            {tilOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setTilOpen(false)} />
                <CalendarPopover
                  value={til}
                  onChoose={(d) => {
                    setTilOpen(false);
                    goCustom(fra || d, d);
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
