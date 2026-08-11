"use client";

import { useTransition } from "react";
import { STAGES, type StageId } from "@/lib/stages";
import { updateDealStage } from "@/lib/actions";
import { celebrateWin } from "@/components/WonCelebration";

export default function StageSelect({
  dealId,
  stage,
  dealName,
}: {
  dealId: number;
  stage: string;
  dealName?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-black/[0.05] p-1">
      {STAGES.map((s) => (
        <button
          key={s.id}
          disabled={pending}
          onClick={() => {
            if (s.id === "vunnet" && stage !== "vunnet") celebrateWin(dealName);
            startTransition(async () => {
              await updateDealStage(dealId, s.id as StageId);
            });
          }}
          className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
            stage === s.id
              ? "bg-white text-ink shadow-card"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}
