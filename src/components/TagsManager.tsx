"use client";

import { useState, useTransition } from "react";
import { createTag, updateTag, deleteTag, reorderTags } from "@/lib/actions";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";

export interface TagRow {
  id: number;
  label: string;
}

// Speiler LostReasonsManager — samme redigerbare liste, bare scoped til én
// entitetstype (deal/person/company) om gangen.
export default function TagsManager({
  entityType,
  tags: initial,
}: {
  entityType: "deal" | "person" | "company";
  tags: TagRow[];
}) {
  const [tags, setTags] = useState(initial);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [addPending, startAdd] = useTransition();

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= tags.length) return;
    const next = [...tags];
    [next[index], next[target]] = [next[target], next[index]];
    setTags(next);
    startTransition(() => reorderTags(next.map((t) => t.id)));
  }

  function saveLabel(id: number, label: string) {
    const trimmed = label.trim();
    const current = tags.find((t) => t.id === id);
    if (!trimmed || trimmed === current?.label) return;
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, label: trimmed } : t)));
    const fd = new FormData();
    fd.set("label", trimmed);
    startTransition(() => updateTag(id, fd));
  }

  function remove(id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTag(id);
      if (res.ok) {
        setTags((prev) => prev.filter((t) => t.id !== id));
      } else {
        setError(res.message);
      }
    });
  }

  function addTag() {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    setError(null);
    const fd = new FormData();
    fd.set("label", label);
    startAdd(async () => {
      const created = await createTag(entityType, fd);
      if (created) {
        setTags((prev) => [...prev, { id: created.id, label: created.label }]);
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
        {tags.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2 rounded-xl bg-mist/[0.03] px-3 py-2">
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
                disabled={i === tags.length - 1}
                className="flex h-4 w-4 items-center justify-center text-ink-faint hover:text-ink disabled:opacity-20"
              >
                <ArrowDown size={12} />
              </button>
            </div>

            <input
              defaultValue={t.label}
              onBlur={(e) => saveLabel(t.id, e.target.value)}
              className="field !flex-1 !border-transparent !bg-transparent !px-2 !py-1 text-[13.5px] font-medium hover:!border-line focus:!border-accent focus:!bg-surface"
            />

            <button
              onClick={() => remove(t.id)}
              title="Slett tag"
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
              addTag();
            }
          }}
          placeholder="Navn på ny tag …"
          className="field flex-1"
        />
        <button
          onClick={addTag}
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
