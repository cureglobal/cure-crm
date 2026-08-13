"use client";

import { useTransition } from "react";
import type { Stage } from "@/lib/stages";
import { updateDealStage } from "@/lib/actions";
import { celebrateWin } from "@/components/WonCelebration";

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
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-mist/[0.05] p-1">
      {stages.map((s) => {
        const sId = String(s.id);
        return (
          <button
            key={s.id}
            disabled={pending}
            onClick={() => {
              if (s.isWon && stage !== sId) celebrateWin(dealName);
              startTransition(async () => {
                await updateDealStage(dealId, sId);
              });
            }}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
              stage === sId
                ? "bg-surface text-ink shadow-card"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
