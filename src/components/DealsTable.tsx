"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  updateDealInline,
  updateDealStage,
  markDealLost,
  bulkSetDealStage,
  bulkMarkDealsLost,
  bulkSetDealOwner,
  bulkAddDealOwner,
  bulkDeleteDeals,
} from "@/lib/actions";
import { formatMoney, formatNumberInput } from "@/lib/format";
import CompanyLogo from "@/components/CompanyLogo";
import DealOwnerCell from "@/components/DealOwnerCell";
import DateField from "@/components/DateField";
import LostReasonDialog, { type LostReasonOption } from "@/components/LostReasonDialog";
import { celebrateWin } from "@/components/WonCelebration";
import type { Stage } from "@/lib/stages";
import { ArrowDown, ArrowUp, Trash2, X } from "lucide-react";

export interface DealRow {
  id: number;
  companyName: string;
  logoUrl: string | null;
  companyBusinessUnitId: number | null;
  ownerId: number;
  ownerName: string;
  ownerAvatarUrl: string | null;
  coOwnerIds: number[];
  title: string;
  stage: string;
  value: number | null;
  hasLines: boolean;
  updatedAt: number;
  followUpAt: number | null;
  followUpInput: string; // yyyy-mm-dd
  comment: string;
}

const GRID = "grid grid-cols-[22px_1.9fr_60px_1fr_150px_1.9fr] items-center gap-3";

type SortKey = "selskap" | "eier" | "verdi" | "dato" | "kommentar";
interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

// Standard retning ved første klikk: verdi høy→lav, resten stigende.
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  selskap: 1,
  eier: 1,
  verdi: -1,
  dato: 1,
  kommentar: 1,
};

function compare(a: DealRow, b: DealRow, sort: Sort): number {
  const dir = sort.dir;
  switch (sort.key) {
    case "selskap":
      return dir * a.companyName.localeCompare(b.companyName, "nb");
    case "eier":
      return dir * a.ownerName.localeCompare(b.ownerName, "nb");
    case "verdi":
      return dir * ((a.value ?? -1) - (b.value ?? -1));
    case "dato": {
      // Deals uten dato havner alltid nederst.
      const av = a.followUpAt ?? (sort.dir === 1 ? Infinity : -Infinity);
      const bv = b.followUpAt ?? (sort.dir === 1 ? Infinity : -Infinity);
      return dir * (av - bv);
    }
    case "kommentar":
      return dir * a.comment.localeCompare(b.comment, "nb");
  }
}

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Row({
  deal,
  selected,
  onToggle,
  owners,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  deal: DealRow;
  selected: boolean;
  onToggle: () => void;
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [dateVal, setDateVal] = useState(deal.followUpInput);
  const overdue = dateVal !== "" && dateVal < todayStr();

  function save(field: string, value: string) {
    const data = new FormData();
    data.set(field, value);
    startTransition(async () => {
      await updateDealInline(deal.id, data);
    });
  }

  return (
    <li
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`border-b border-line last:border-b-0 ${pending ? "opacity-60" : ""} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <div className={`${GRID} px-5 py-2.5 transition hover:bg-mist/[0.015]`}>
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-3.5 w-3.5" />
        <Link href={`/leads/${deal.id}`} className="flex min-w-0 items-center gap-3">
          <CompanyLogo logoUrl={deal.logoUrl} name={deal.companyName} size={32} radius={9} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium hover:text-accent">
              {deal.companyName}
            </span>
            <span className="block truncate text-[11.5px] text-ink-soft">{deal.title}</span>
          </span>
        </Link>

        <DealOwnerCell
          dealId={deal.id}
          ownerId={deal.ownerId}
          ownerName={deal.ownerName}
          ownerAvatarUrl={deal.ownerAvatarUrl}
          coOwnerIds={deal.coOwnerIds}
          owners={owners}
        />

        {deal.hasLines ? (
          <span
            className="px-2 text-right text-[13px] font-medium tabular-nums text-ink-soft"
            title="Beregnes fra varelinjene"
          >
            {formatMoney(deal.value)}
          </span>
        ) : (
          <input
            defaultValue={formatNumberInput(deal.value)}
            inputMode="numeric"
            placeholder="—"
            onBlur={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, "");
              if ((raw ? Number(raw) : null) !== deal.value) save("value", raw);
            }}
            className="field !border-transparent !bg-transparent !px-2 !py-1.5 text-right text-[13px] font-medium tabular-nums hover:!border-line focus:!border-accent focus:!bg-surface"
          />
        )}

        <DateField
          value={dateVal}
          onChange={(v) => {
            setDateVal(v);
            save("followUpAt", v);
          }}
          overdue={overdue}
          className="field !border-transparent !bg-transparent !px-2 !py-1.5 text-[12.5px] hover:!border-line"
        />

        <div className="group relative">
          <input
            defaultValue={deal.comment}
            placeholder="Legg til kommentar …"
            onBlur={(e) => {
              if (e.target.value.trim() !== deal.comment) {
                save("comment", e.target.value.trim());
              }
            }}
            className="field !border-transparent !bg-transparent !px-2 !py-1.5 text-[13px] text-ink-soft hover:!border-line focus:!border-accent focus:!bg-surface focus:text-ink"
          />
          {deal.comment && (
            <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-72 max-w-[80vw] whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 text-[12.5px] leading-relaxed text-ink opacity-0 shadow-pop transition-opacity duration-100 group-hover:opacity-100">
              {deal.comment}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function HeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition hover:text-ink ${
        active ? "text-ink" : "text-ink-faint"
      } ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : ""}`}
    >
      {label}
      {active &&
        (sort!.dir === 1 ? <ArrowUp size={11} strokeWidth={2.5} /> : <ArrowDown size={11} strokeWidth={2.5} />)}
    </button>
  );
}

export default function DealsTable({
  rows,
  stages,
  owners,
  lostReasons,
  groupByStage = false,
}: {
  rows: DealRow[];
  stages: Stage[];
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
  lostReasons: LostReasonOption[];
  groupByStage?: boolean;
}) {
  const [sort, setSort] = useState<Sort | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [stageChoice, setStageChoice] = useState("");
  const [ownerChoice, setOwnerChoice] = useState("");
  const [addOwnerChoice, setAddOwnerChoice] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [pendingLostStageId, setPendingLostStageId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [pendingLostDrop, setPendingLostDrop] = useState<{
    dealId: number;
    stageId: string;
  } | null>(null);

  function onSort(key: SortKey) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: DEFAULT_DIR[key] }
    );
  }

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => compare(a, b, sort));
  }, [rows, sort]);

  const allVisibleSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of sorted) next.delete(r.id);
      } else {
        for (const r of sorted) next.add(r.id);
      }
      return next;
    });
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setConfirmingDelete(false);
    setBulkMessage(null);
  }

  function applyStage(stageId: string) {
    if (!stageId) return;
    const stageRow = stages.find((s) => String(s.id) === stageId);
    if (stageRow?.isLost) {
      setPendingLostStageId(stageId);
      return;
    }
    const ids = [...selected];
    startTransition(async () => {
      await bulkSetDealStage(ids, stageId);
      setBulkMessage(`Flyttet ${ids.length} deals.`);
      setStageChoice("");
    });
  }

  function confirmLost(lostReasonId: number, comment: string) {
    if (!pendingLostStageId) return;
    const ids = [...selected];
    const stageId = pendingLostStageId;
    setPendingLostStageId(null);
    startTransition(async () => {
      await bulkMarkDealsLost(ids, stageId, lostReasonId, comment);
      setBulkMessage(`Markerte ${ids.length} deals som tapt.`);
      setStageChoice("");
    });
  }

  function handleDragStart(dealId: number, e: React.DragEvent) {
    e.dataTransfer.setData("text/deal-id", String(dealId));
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  }

  function handleDragEnd() {
    setIsDragging(false);
    setDragOverStageId(null);
  }

  function handleDrop(stage: Stage, e: React.DragEvent) {
    e.preventDefault();
    setDragOverStageId(null);
    const dealId = Number(e.dataTransfer.getData("text/deal-id"));
    if (!dealId) return;
    const deal = rows.find((r) => r.id === dealId);
    const stageId = String(stage.id);
    if (!deal || deal.stage === stageId) return;
    if (stage.isLost) {
      setPendingLostDrop({ dealId, stageId });
      return;
    }
    if (stage.isWon) celebrateWin(`${deal.companyName} · ${deal.title}`);
    startTransition(async () => {
      await updateDealStage(dealId, stageId);
    });
  }

  function confirmLostDrop(lostReasonId: number, comment: string) {
    if (!pendingLostDrop) return;
    const { dealId, stageId } = pendingLostDrop;
    setPendingLostDrop(null);
    startTransition(async () => {
      await markDealLost(dealId, stageId, lostReasonId, comment);
    });
  }

  function applyOwner(ownerId: string) {
    if (!ownerId) return;
    const ids = [...selected];
    startTransition(async () => {
      await bulkSetDealOwner(ids, Number(ownerId));
      setBulkMessage(`Satt eier på ${ids.length} deals.`);
      setOwnerChoice("");
    });
  }

  function applyAddOwner(userId: string) {
    if (!userId) return;
    const ids = [...selected];
    startTransition(async () => {
      await bulkAddDealOwner(ids, Number(userId));
      setBulkMessage(`Lagt til som eier på ${ids.length} deals.`);
      setAddOwnerChoice("");
    });
  }

  function applyDelete() {
    const ids = [...selected];
    startTransition(async () => {
      await bulkDeleteDeals(ids);
      clearSelection();
    });
  }

  const groups = useMemo(() => {
    if (!groupByStage) return null;
    return stages
      .map((s) => ({
        stage: s,
        items: sorted.filter((r) => r.stage === String(s.id)),
      }))
      .filter((g) => isDragging || g.items.length > 0);
  }, [sorted, groupByStage, stages, isDragging]);

  const header = (
    <div
      className={`${GRID} sticky top-0 z-20 border-b border-line bg-surface/95 px-5 py-2.5 backdrop-blur-xl`}
    >
      <input
        type="checkbox"
        checked={allVisibleSelected}
        onChange={toggleAll}
        className="h-3.5 w-3.5"
      />
      <HeaderCell label="Selskap" sortKey="selskap" sort={sort} onSort={onSort} />
      <HeaderCell label="Eier" sortKey="eier" sort={sort} onSort={onSort} align="center" />
      <span className="flex justify-end px-2">
        <HeaderCell label="Verdi" sortKey="verdi" sort={sort} onSort={onSort} align="right" />
      </span>
      <span className="px-2">
        <HeaderCell label="Dato" sortKey="dato" sort={sort} onSort={onSort} />
      </span>
      <span className="px-2">
        <HeaderCell label="Kommentar" sortKey="kommentar" sort={sort} onSort={onSort} />
      </span>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="min-w-[880px]">
        {header}
        <p className="px-5 py-10 text-center text-[13px] text-ink-faint">
          Ingen deals matcher filtrene.
        </p>
      </div>
    );
  }

  // Ingen boks/overflow rundt listen — den skal bare flyte som resten av
  // siden (også fordi overflow-x-auto her gjorde at popover-menyer inni
  // radene, f.eks. datovelgeren, ble klippet av kortets ytterkant).
  return (
    <div>
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-3">
          <span className="text-[13px] font-medium">{selected.size} valgt</span>

          <select
            value={stageChoice}
            onChange={(e) => {
              setStageChoice(e.target.value);
              applyStage(e.target.value);
            }}
            disabled={pending}
            className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
          >
            <option value="">Sett fase …</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={ownerChoice}
            onChange={(e) => {
              setOwnerChoice(e.target.value);
              applyOwner(e.target.value);
            }}
            disabled={pending}
            className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
          >
            <option value="">Sett eier …</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <select
            value={addOwnerChoice}
            onChange={(e) => {
              setAddOwnerChoice(e.target.value);
              applyAddOwner(e.target.value);
            }}
            disabled={pending}
            title="Legger til som med-eier, uten å erstatte hovedeieren"
            className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
          >
            <option value="">Legg til eier …</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          {confirmingDelete ? (
            <span className="flex items-center gap-2 rounded-full bg-danger/10 px-3 py-1.5">
              <span className="text-[12.5px] text-danger">Slette {selected.size} deals?</span>
              <button onClick={applyDelete} disabled={pending} className="btn btn-danger !py-1">
                Ja, slett
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-[12.5px] font-medium text-ink-soft hover:text-ink"
              >
                Avbryt
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              className="btn btn-danger !py-1.5"
            >
              <Trash2 size={13} />
              Slett
            </button>
          )}

          {bulkMessage && <span className="text-[12.5px] text-ink-soft">{bulkMessage}</span>}

          <button
            onClick={clearSelection}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/[0.06]"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="min-w-[880px]">
        {header}
        {groups ? (
          groups.map((g) => {
            const sum = g.items.reduce((acc, r) => acc + (r.value ?? 0), 0);
            const stageId = String(g.stage.id);
            const isOver = dragOverStageId === stageId;
            return (
              <div
                key={g.stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStageId(stageId);
                }}
                onDragLeave={() => setDragOverStageId((s) => (s === stageId ? null : s))}
                onDrop={(e) => handleDrop(g.stage, e)}
                className={`transition-colors ${isOver ? "bg-accent-soft/40" : ""}`}
              >
                <div className="sticky top-[41px] z-10 flex items-center gap-2 border-b border-line bg-canvas/95 px-5 py-2 backdrop-blur-xl">
                  <span className="h-2 w-2 rounded-full" style={{ background: g.stage.color }} />
                  <span className="text-[12.5px] font-semibold">{g.stage.label}</span>
                  <span className="text-[12px] text-ink-faint">{g.items.length}</span>
                  {sum > 0 && (
                    <span className="ml-auto text-[12px] tabular-nums text-ink-soft">
                      {formatMoney(sum)}
                    </span>
                  )}
                </div>
                <ul>
                  {g.items.map((deal) => (
                    <Row
                      key={deal.id}
                      deal={deal}
                      selected={selected.has(deal.id)}
                      onToggle={() => toggleOne(deal.id)}
                      owners={owners}
                      draggable
                      onDragStart={(e) => handleDragStart(deal.id, e)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </ul>
                {isDragging && g.items.length === 0 && (
                  <div
                    className={`mx-5 mb-2 flex items-center justify-center rounded-xl border-2 border-dashed px-3 py-4 text-[12px] font-medium ${
                      isOver ? "border-accent/50 bg-accent-soft/40 text-accent" : "border-line text-ink-faint"
                    }`}
                  >
                    Slipp her
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <ul>
            {sorted.map((deal) => (
              <Row
                key={deal.id}
                deal={deal}
                selected={selected.has(deal.id)}
                onToggle={() => toggleOne(deal.id)}
                owners={owners}
              />
            ))}
          </ul>
        )}
      </div>

      {pendingLostStageId && (
        <LostReasonDialog
          reasons={lostReasons}
          dealCount={selected.size}
          pending={pending}
          onConfirm={confirmLost}
          onCancel={() => {
            setPendingLostStageId(null);
            setStageChoice("");
          }}
        />
      )}

      {pendingLostDrop && (
        <LostReasonDialog
          reasons={lostReasons}
          pending={pending}
          onConfirm={confirmLostDrop}
          onCancel={() => setPendingLostDrop(null)}
        />
      )}
    </div>
  );
}
