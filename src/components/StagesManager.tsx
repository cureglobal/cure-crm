"use client";

import { useState, useTransition } from "react";
import { createStage, updateStage, deleteStage, reorderStages } from "@/lib/actions";
import { ArrowUp, ArrowDown, Trash2, Plus, Trophy, ThumbsDown } from "lucide-react";

export interface StageRow {
  id: number;
  label: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
}

const SWATCHES = [
  "#8e8e93", "#0071e3", "#5e5ce6", "#bf5af2", "#ff375f", "#ff453a",
  "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#5ac8fa", "#a2845e",
];

export default function StagesManager({
  stages: initial,
  pipelineId,
}: {
  stages: StageRow[];
  pipelineId: number;
}) {
  const [stages, setStages] = useState(initial);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [addPending, startAdd] = useTransition();

  function patch(id: number, changes: Partial<StageRow>) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
    startTransition(() => reorderStages(next.map((s) => s.id)));
  }

  function saveLabel(id: number, label: string) {
    const trimmed = label.trim();
    const current = stages.find((s) => s.id === id);
    if (!trimmed || trimmed === current?.label) return;
    patch(id, { label: trimmed });
    const fd = new FormData();
    fd.set("label", trimmed);
    startTransition(() => updateStage(id, fd));
  }

  function saveColor(id: number, color: string) {
    patch(id, { color });
    const fd = new FormData();
    fd.set("color", color);
    startTransition(() => updateStage(id, fd));
  }

  function toggleFlag(id: number, flag: "isWon" | "isLost") {
    const current = stages.find((s) => s.id === id);
    if (!current) return;
    const value = !current[flag];
    patch(id, { [flag]: value } as Partial<StageRow>);
    const fd = new FormData();
    fd.set(flag, value ? "1" : "0");
    startTransition(() => updateStage(id, fd));
  }

  function remove(id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deleteStage(id);
      if (res.ok) {
        setStages((prev) => prev.filter((s) => s.id !== id));
      } else {
        setError(res.message);
      }
    });
  }

  function addStage() {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    setError(null);
    const fd = new FormData();
    fd.set("label", label);
    fd.set("color", SWATCHES[stages.length % SWATCHES.length]);
    startAdd(async () => {
      const created = await createStage(pipelineId, fd);
      if (created) {
        setStages((prev) => [
          ...prev,
          { id: created.id, label: created.label, color: created.color, isWon: created.isWon, isLost: created.isLost },
        ]);
      }
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {stages.map((s, i) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-xl bg-mist/[0.03] px-3 py-2"
          >
            <div className="flex flex-col">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="flex h-4 w-4 items-center justify-center text-ink-faint hover:text-ink disabled:opacity-20"
              >
                <ArrowUp size={12} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === stages.length - 1}
                className="flex h-4 w-4 items-center justify-center text-ink-faint hover:text-ink disabled:opacity-20"
              >
                <ArrowDown size={12} />
              </button>
            </div>

            <div className="group relative shrink-0">
              <span
                className="block h-5 w-5 rounded-full ring-1 ring-black/10"
                style={{ background: s.color }}
              />
              <div className="absolute left-0 top-6 z-30 hidden w-[168px] flex-wrap gap-1.5 rounded-xl border border-line bg-surface p-2 shadow-card group-hover:flex">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => saveColor(s.id, c)}
                    className="h-5 w-5 rounded-full ring-1 ring-black/10"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            <input
              defaultValue={s.label}
              onBlur={(e) => saveLabel(s.id, e.target.value)}
              className="field !flex-1 !border-transparent !bg-transparent !px-2 !py-1 text-[13.5px] font-medium hover:!border-line focus:!border-accent focus:!bg-surface"
            />

            <button
              onClick={() => toggleFlag(s.id, "isWon")}
              title="Marker som vunnet-fase"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                s.isWon ? "bg-success/15 text-success-ink" : "text-ink-faint hover:bg-mist/[0.06]"
              }`}
            >
              <Trophy size={13} />
            </button>
            <button
              onClick={() => toggleFlag(s.id, "isLost")}
              title="Marker som tapt-fase"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                s.isLost ? "bg-danger/15 text-danger" : "text-ink-faint hover:bg-mist/[0.06]"
              }`}
            >
              <ThumbsDown size={13} />
            </button>

            <button
              onClick={() => remove(s.id)}
              title="Slett fase"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addStage();
            }
          }}
          placeholder="Navn på ny fase …"
          className="field flex-1"
        />
        <button
          onClick={addStage}
          disabled={addPending || !newLabel.trim()}
          className="btn btn-secondary shrink-0"
        >
          <Plus size={14} />
          Legg til
        </button>
      </div>
    </div>
  );
}
