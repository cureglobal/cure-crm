"use client";

import { useState, useTransition } from "react";
import { createTag } from "@/lib/actions";
import { Plus, X } from "lucide-react";

export interface TagOption {
  id: number;
  label: string;
}

// Generisk tag-redigering for én enkelt deal/person/selskap — brukt på
// detaljsider. Endringer skjer momentant (ikke utsatt-til-lukking som
// eier-velgerne), siden tagger ikke har noe "hoved"-konsept å holde styr på.
// Kan i tillegg opprette en helt ny tag direkte herfra — man trenger ikke
// innom Innstillinger bare for å legge til én tag man kom på der og da.
export default function TagsEditor({
  entityType,
  allTags,
  initialSelectedIds,
  onAdd,
  onRemove,
}: {
  entityType: "deal" | "person" | "company";
  allTags: TagOption[];
  initialSelectedIds: number[];
  onAdd: (tagId: number) => Promise<void> | void;
  onRemove: (tagId: number) => Promise<void> | void;
}) {
  const [tags, setTags] = useState(allTags);
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [, startTransition] = useTransition();
  const [createPending, startCreate] = useTransition();

  const selected = tags.filter((t) => selectedIds.includes(t.id));
  const unselected = tags.filter((t) => !selectedIds.includes(t.id));

  function add(tagId: number) {
    setSelectedIds((prev) => [...prev, tagId]);
    setOpen(false);
    startTransition(() => onAdd(tagId));
  }

  function remove(tagId: number) {
    setSelectedIds((prev) => prev.filter((id) => id !== tagId));
    startTransition(() => onRemove(tagId));
  }

  function createAndAdd() {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    const fd = new FormData();
    fd.set("label", label);
    startCreate(async () => {
      const created = await createTag(entityType, fd);
      if (!created) return;
      setTags((prev) => [...prev, { id: created.id, label: created.label }]);
      setSelectedIds((prev) => [...prev, created.id]);
      setOpen(false);
      await onAdd(created.id);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((t) => (
        <span
          key={t.id}
          className="group flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent"
        >
          {t.label}
          <button
            type="button"
            onClick={() => remove(t.id)}
            className="text-accent/60 transition hover:text-accent"
          >
            <X size={11} />
          </button>
        </span>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-full bg-mist/[0.05] px-2.5 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink"
        >
          <Plus size={11} />
          Tag
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
              {unselected.length > 0 && (
                <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                  {unselected.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => add(t.id)}
                        className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-mist/[0.05]"
                      >
                        {t.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div
                className={`flex items-center gap-1 ${
                  unselected.length > 0 ? "mt-1.5 border-t border-line pt-1.5" : ""
                }`}
              >
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createAndAdd();
                    }
                  }}
                  placeholder="Ny tag …"
                  className="field !flex-1 !py-1 text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={createAndAdd}
                  disabled={createPending || !newLabel.trim()}
                  title="Opprett ny tag"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-mist/[0.08] hover:text-ink disabled:opacity-40"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
