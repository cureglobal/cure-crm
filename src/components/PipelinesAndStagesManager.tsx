"use client";

import { useState, useTransition } from "react";
import StagesManager, { type StageRow } from "@/components/StagesManager";
import { createPipeline, renamePipeline, deletePipeline } from "@/lib/actions";
import { Plus, Trash2 } from "lucide-react";

export interface PipelineRow {
  id: number;
  name: string;
}

// Faner for hver pipeline (Salg, Anbud, …), hver med sitt eget sett faser
// under. StagesManager får `key={activeId}` slik at den remountes (og
// dermed nullstiller sin lokale state) når man bytter fane.
export default function PipelinesAndStagesManager({
  pipelines: initialPipelines,
  stagesByPipeline,
}: {
  pipelines: PipelineRow[];
  stagesByPipeline: Record<number, StageRow[]>;
}) {
  const [pipelines, setPipelines] = useState(initialPipelines);
  const [activeId, setActiveId] = useState(initialPipelines[0]?.id ?? 0);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [newName, setNewName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [addPending, startAdd] = useTransition();

  function addPipeline() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setShowAdd(false);
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    startAdd(async () => {
      const created = await createPipeline(fd);
      if (created) {
        setPipelines((prev) => [...prev, { id: created.id, name: created.name }]);
        setActiveId(created.id);
      }
    });
  }

  function startRename() {
    setRenameValue(pipelines.find((p) => p.id === activeId)?.name ?? "");
    setRenaming(true);
  }

  function saveRename() {
    const name = renameValue.trim();
    setRenaming(false);
    if (!name) return;
    setPipelines((prev) => prev.map((p) => (p.id === activeId ? { ...p, name } : p)));
    const fd = new FormData();
    fd.set("name", name);
    startTransition(() => renamePipeline(activeId, fd));
  }

  function remove(id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deletePipeline(id);
      if (res.ok) {
        setPipelines((prev) => {
          const next = prev.filter((p) => p.id !== id);
          if (activeId === id) setActiveId(next[0]?.id ?? 0);
          return next;
        });
      } else {
        setError(res.message);
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-full bg-mist/[0.05] p-1">
          {pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                activeId === p.id ? "bg-surface shadow-card" : "text-ink-soft hover:text-ink"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
        >
          <Plus size={12} />
          Ny pipeline
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPipeline()}
            placeholder="Navn på ny pipeline …"
            autoFocus
            className="field flex-1"
          />
          <button
            onClick={addPipeline}
            disabled={addPending || !newName.trim()}
            className="btn btn-secondary shrink-0"
          >
            Legg til
          </button>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        {renaming ? (
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveRename()}
            onBlur={saveRename}
            autoFocus
            className="field !w-auto !py-1 text-[13px]"
          />
        ) : (
          <button
            onClick={startRename}
            className="text-[12.5px] font-medium text-ink-soft hover:text-ink hover:underline"
          >
            Gi nytt navn til «{pipelines.find((p) => p.id === activeId)?.name}»
          </button>
        )}
        {pipelines.length > 1 && (
          <button
            onClick={() => remove(activeId)}
            className="flex items-center gap-1 text-[12.5px] font-medium text-ink-faint hover:text-danger"
          >
            <Trash2 size={12} />
            Slett pipeline
          </button>
        )}
      </div>

      <StagesManager key={activeId} pipelineId={activeId} stages={stagesByPipeline[activeId] ?? []} />
    </div>
  );
}
