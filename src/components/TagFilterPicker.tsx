"use client";

import { useState } from "react";
import { Check, ChevronDown, Tag as TagIcon } from "lucide-react";

export interface TagFilterValue {
  ids: number[];
  mode: "any" | "all"; // any = enkelte (OR), all = alle (AND)
}

export const ALL_TAGS_FILTER: TagFilterValue = { ids: [], mode: "any" };

export function matchesTagFilter(itemTagIds: number[], filter: TagFilterValue): boolean {
  if (filter.ids.length === 0) return true;
  return filter.mode === "all"
    ? filter.ids.every((id) => itemTagIds.includes(id))
    : filter.ids.some((id) => itemTagIds.includes(id));
}

// Flervalgs-tagfilter med alle/enkelte-modus — brukt på Bedrifter- og
// Personer-oversikten. Modusvalget dukker først opp når man faktisk har
// valgt mer enn én tag (ett valg er per definisjon både "alle" og "enkelte").
export default function TagFilterPicker({
  tags,
  value,
  onChange,
}: {
  tags: { id: number; label: string }[];
  value: TagFilterValue;
  onChange: (v: TagFilterValue) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggleTag(id: number) {
    const ids = value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id];
    onChange({ ...value, ids });
  }

  const label =
    value.ids.length === 0
      ? "Alle tagger"
      : value.ids.length === 1
        ? (tags.find((t) => t.id === value.ids[0])?.label ?? "1 tag")
        : `${value.ids.length} tagger`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="field flex !w-auto items-center gap-1.5 !rounded-full !py-1.5 text-[12.5px]"
      >
        <TagIcon size={12} className="text-ink-faint" />
        {label}
        <ChevronDown size={12} className="text-ink-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {tags.map((t) => {
                const checked = value.ids.includes(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-mist/[0.05]"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? "border-accent bg-accent text-accent-ink" : "border-line"
                        }`}
                      >
                        {checked && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {value.ids.length > 1 && (
              <div className="mt-1.5 flex items-center gap-1 border-t border-line pt-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ ...value, mode: "all" })}
                  className={`flex-1 rounded-lg px-2 py-1 text-[11.5px] font-medium transition ${
                    value.mode === "all"
                      ? "bg-accent-soft text-accent"
                      : "text-ink-soft hover:bg-mist/[0.05]"
                  }`}
                  title="Match selskap/personer som har ALLE valgte tagger"
                >
                  Alle
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...value, mode: "any" })}
                  className={`flex-1 rounded-lg px-2 py-1 text-[11.5px] font-medium transition ${
                    value.mode === "any"
                      ? "bg-accent-soft text-accent"
                      : "text-ink-soft hover:bg-mist/[0.05]"
                  }`}
                  title="Match selskap/personer som har MINST ÉN av de valgte taggene"
                >
                  Noen
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
