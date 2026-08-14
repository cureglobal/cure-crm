"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import type { Stage } from "@/lib/stages";
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
  ownerAvatarUrl: string | null;
  coOwnerCount: number;
}

export default function KanbanBoard({ deals, stages }: { deals: KanbanDeal[]; stages: Stage[] }) {
  const [, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(
    deals,
    (state, move: { id: number; stage: string }) =>
      state.map((d) => (d.id === move.id ? { ...d, stage: move.stage } : d))
  );
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Sann fra dragstart til dragend/drop — lar oss vise alle fasene (komprimert
  // for de tomme) mens man drar, uten at de tar plass ellers.
  const [isDragging, setIsDragging] = useState(false);

  function onDrop(stage: Stage, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    setIsDragging(false);
    const id = Number(e.dataTransfer.getData("text/deal-id"));
    if (!id) return;
    const deal = optimistic.find((d) => d.id === id);
    const stageId = String(stage.id);
    if (!deal || deal.stage === stageId) return;
    if (stage.isWon) celebrateWin(`${deal.companyName} · ${deal.title}`);
    startTransition(async () => {
      applyMove({ id, stage: stageId });
      await updateDealStage(id, stageId);
    });
  }

  // Til vanlig vises bare fasene som faktisk har en deal i seg. Så snart man
  // begynner å dra et kort, vises alle fasene som gyldige mål — de tomme
  // komprimert til en smal kolonne i stedet for å ta full bredde.
  const nonEmptyStages = stages.filter((stage) =>
    optimistic.some((d) => d.stage === String(stage.id))
  );
  const displayStages = isDragging ? stages : nonEmptyStages;

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {displayStages.map((stage) => {
        const items = optimistic.filter((d) => d.stage === String(stage.id));
        const sum = items.reduce((acc, d) => acc + (d.value ?? 0), 0);
        const isOver = dragOver === String(stage.id);
        const compressed = isDragging && items.length === 0;
        return (
          <div
            key={stage.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(String(stage.id));
            }}
            onDragLeave={() => setDragOver((s) => (s === String(stage.id) ? null : s))}
            onDrop={(e) => onDrop(stage, e)}
            className={`flex shrink-0 flex-col rounded-2xl border p-2 transition-all duration-150 ${
              compressed ? "w-[56px]" : "w-[264px]"
            } ${
              isOver
                ? "border-accent/40 bg-accent-soft/60"
                : "border-transparent bg-mist/[0.03]"
            }`}
          >
            {compressed ? (
              <div className="flex flex-1 flex-col items-center gap-2 py-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: stage.color }}
                />
                <span
                  className="max-h-[160px] truncate text-[11px] font-medium text-ink-soft"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {stage.label}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-2.5 pb-2 pt-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: stage.color }}
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
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/deal-id", String(deal.id));
                          setIsDragging(true);
                        }}
                        onDragEnd={() => {
                          setIsDragging(false);
                          setDragOver(null);
                        }}
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
                                    ? "bg-warning/15 text-warning-ink"
                                    : "bg-mist/[0.05] text-ink-soft"
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
                                <Avatar name={deal.ownerName} imageUrl={deal.ownerAvatarUrl} size={20} />
                                {deal.coOwnerCount > 0 && (
                                  <span
                                    title={`${deal.coOwnerCount} med-eier${deal.coOwnerCount === 1 ? "" : "e"}`}
                                    className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-mist/[0.08] text-[8px] font-semibold text-ink-soft"
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
                  {isOver && (
                    <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/50 bg-accent-soft/40 px-3 py-4 text-[12px] font-medium text-accent">
                      Slipp her
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
