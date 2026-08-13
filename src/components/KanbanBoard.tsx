"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { STAGES, type StageId } from "@/lib/stages";
import { updateDealStage } from "@/lib/actions";
import { relativeDay, formatMoney } from "@/lib/format";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import { celebrateWin } from "@/components/WonCelebration";
import { CalendarDays } from "lucide-react";

export interface KanbanDeal {
  id: number;
  title: string;
  companyName: string;
  logoUrl: string | null;
  stage: string;
  value: number | null;
  followUpAt: number | null;
  ownerName: string;
  coOwnerCount: number;
}

export default function KanbanBoard({ deals }: { deals: KanbanDeal[] }) {
  const [, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(
    deals,
    (state, move: { id: number; stage: StageId }) =>
      state.map((d) => (d.id === move.id ? { ...d, stage: move.stage } : d))
  );
  const [dragOver, setDragOver] = useState<StageId | null>(null);

  function onDrop(stage: StageId, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/deal-id"));
    if (!id) return;
    const deal = optimistic.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    if (stage === "vunnet") celebrateWin(`${deal.companyName} · ${deal.title}`);
    startTransition(async () => {
      applyMove({ id, stage });
      await updateDealStage(id, stage);
    });
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STAGES.map((stage) => {
        const items = optimistic.filter((d) => d.stage === stage.id);
        const sum = items.reduce((acc, d) => acc + (d.value ?? 0), 0);
        return (
          <div
            key={stage.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(stage.id);
            }}
            onDragLeave={() => setDragOver((s) => (s === stage.id ? null : s))}
            onDrop={(e) => onDrop(stage.id, e)}
            className={`flex w-[264px] shrink-0 flex-col rounded-2xl border p-2 transition ${
              dragOver === stage.id
                ? "border-accent/40 bg-accent-soft/60"
                : "border-transparent bg-black/[0.03]"
            }`}
          >
            <div className="flex items-center gap-2 px-2.5 pb-2 pt-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: stage.dot }}
              />
              <span className="text-[13px] font-semibold">{stage.label}</span>
              <span className="text-[12px] text-ink-faint">{items.length}</span>
              {sum > 0 && (
                <span className="ml-auto text-[11.5px] text-ink-faint">
                  {formatMoney(sum)}
                </span>
              )}
            </div>

            <div className="flex min-h-[60px] flex-col gap-2">
              {items.map((deal) => {
                const followUp = deal.followUpAt ? new Date(deal.followUpAt) : null;
                const rel = followUp ? relativeDay(followUp) : null;
                return (
                  <Link
                    key={deal.id}
                    href={`/leads/${deal.id}`}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/deal-id", String(deal.id))
                    }
                    className="card cursor-grab p-3 transition hover:shadow-pop active:cursor-grabbing"
                  >
                    <div className="flex items-center gap-2.5">
                      <CompanyLogo logoUrl={deal.logoUrl} name={deal.companyName} size={30} radius={8} />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium">
                          {deal.companyName}
                        </p>
                        <p className="truncate text-[12px] text-ink-soft">{deal.title}</p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                      {rel && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            rel.tone === "overdue"
                              ? "bg-danger/10 text-danger"
                              : rel.tone === "today"
                                ? "bg-warning/15 text-[#b06a00]"
                                : "bg-black/[0.05] text-ink-soft"
                          }`}
                        >
                          <CalendarDays size={11} />
                          {rel.label}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        {deal.value ? (
                          <span className="text-[11.5px] font-medium text-ink-soft">
                            {formatMoney(deal.value)}
                          </span>
                        ) : null}
                        {deal.ownerName && (
                          <span className="relative">
                            <Avatar name={deal.ownerName} size={20} />
                            {deal.coOwnerCount > 0 && (
                              <span
                                title={`${deal.coOwnerCount} med-eier${deal.coOwnerCount === 1 ? "" : "e"}`}
                                className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/[0.08] text-[8px] font-semibold text-ink-soft"
                              >
                                +{deal.coOwnerCount}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
