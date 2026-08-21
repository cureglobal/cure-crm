"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";

export interface TagOption {
  id: number;
  label: string;
}

// Generisk tag-redigering for én enkelt deal/person — brukt på detaljsider.
// Endringer skjer momentant (ikke utsatt-til-lukking som eier-velgerne),
// siden tagger ikke har noe "hoved"-konsept å holde styr på.
export default function TagsEditor({
  allTags,
  initialSelectedIds,
  onAdd,
  onRemove,
}: {
  allTags: TagOption[];
  initialSelectedIds: number[];
  onAdd: (tagId: number) => Promise<void> | void;
  onRemove: (tagId: number) => Promise<void> | void;
}) {
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const selected = allTags.filter((t) => selectedIds.includes(t.id));
  const unselected = allTags.filter((t) => !selectedIds.includes(t.id));

  function add(tagId: number) {
    setSelectedIds((prev) => [...prev, tagId]);
    setOpen(false);
    startTransition(() => onAdd(tagId));
  }

  function remove(tagId: number) {
    setSelectedIds((prev) => prev.filter((id) => id !== tagId));
    startTransition(() => onRemove(tagId));
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

      {unselected.length > 0 && (
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
              <div className="absolute left-0 top-full z-40 mt-1.5 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
                <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
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
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
