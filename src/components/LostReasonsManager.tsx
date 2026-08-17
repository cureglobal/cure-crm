"use client";

import { useState, useTransition } from "react";
import {
  createLostReason,
  updateLostReason,
  deleteLostReason,
  reorderLostReasons,
} from "@/lib/actions";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";

export interface LostReasonRow {
  id: number;
  label: string;
}

export default function LostReasonsManager({ reasons: initial }: { reasons: LostReasonRow[] }) {
  const [reasons, setReasons] = useState(initial);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [addPending, startAdd] = useTransition();

  function patch(id: number, changes: Partial<LostReasonRow>) {
    setReasons((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= reasons.length) return;
    const next = [...reasons];
    [next[index], next[target]] = [next[target], next[index]];
    setReasons(next);
    startTransition(() => reorderLostReasons(next.map((r) => r.id)));
  }

  function saveLabel(id: number, label: string) {
    const trimmed = label.trim();
    const current = reasons.find((r) => r.id === id);
    if (!trimmed || trimmed === current?.label) return;
    patch(id, { label: trimmed });
    const fd = new FormData();
    fd.set("label", trimmed);
    startTransition(() => updateLostReason(id, fd));
  }

  function remove(id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deleteLostReason(id);
      if (res.ok) {
        setReasons((prev) => prev.filter((r) => r.id !== id));
      } else {
        setError(res.message);
      }
    });
  }

  function addReason() {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    setError(null);
    const fd = new FormData();
    fd.set("label", label);
    startAdd(async () => {
      const created = await createLostReason(fd);
      if (created) {
        setReasons((prev) => [...prev, { id: created.id, label: created.label }]);
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
        {reasons.map((r, i) => (
          <li
            key={r.id}
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
                disabled={i === reasons.length - 1}
                className="flex h-4 w-4 items-center justify-center text-ink-faint hover:text-ink disabled:opacity-20"
              >
                <ArrowDown size={12} />
              </button>
            </div>

            <input
              defaultValue={r.label}
              onBlur={(e) => saveLabel(r.id, e.target.value)}
              className="field !flex-1 !border-transparent !bg-transparent !px-2 !py-1 text-[13.5px] font-medium hover:!border-line focus:!border-accent focus:!bg-surface"
            />

            <button
              onClick={() => remove(r.id)}
              title="Slett grunn"
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
              addReason();
            }
          }}
          placeholder="Navn på ny grunn …"
          className="field flex-1"
        />
        <button
          onClick={addReason}
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
