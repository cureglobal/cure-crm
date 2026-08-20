"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  type SavedViewFilters,
  type SavedViewRow,
} from "@/lib/actions";
import { Bookmark, Plus, Trash2 } from "lucide-react";

// Lagre/gjenåpne navngitte, delbare filterkombinasjoner for Pipeline-siden.
// Delt/team-synlig — alle ser samme liste. `filters` er gjeldende
// filtertilstand fra PipelineView, klar til å lagres uendret. Pipeline-
// bryteren bor her også (ikke som egen alltid-synlig rad) — det er ikke
// noe man bytter mellom så ofte at det trenger fast plass i verktøylinjen.
export default function SavedViewsMenu({
  filters,
  pipelines,
  pipelineId,
  onPipelineChange,
}: {
  filters: SavedViewFilters;
  pipelines: { id: number; name: string }[];
  pipelineId: number;
  onPipelineChange: (id: number) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedViewRow[] | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  function openMenu() {
    setOpen(true);
    setError(null);
    startLoading(async () => {
      setViews(await listSavedViews());
    });
  }

  function closeMenu() {
    setOpen(false);
    setShowSaveForm(false);
    setError(null);
  }

  function save() {
    if (!name.trim()) return;
    startSaving(async () => {
      const res = await createSavedView(name, filters);
      if (res.ok && res.slug) {
        setName("");
        setShowSaveForm(false);
        closeMenu();
        router.push(`/leads/visning/${res.slug}`);
      } else {
        setError(res.message);
      }
    });
  }

  function remove(id: number) {
    startLoading(async () => {
      await deleteSavedView(id);
      setViews((prev) => prev?.filter((v) => v.id !== id) ?? prev);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        className="flex items-center gap-1.5 rounded-full bg-mist/[0.05] px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition hover:text-ink"
      >
        <Bookmark size={13} />
        Visninger
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeMenu} />
          <div
            className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-line bg-surface p-2 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            {pipelines.length > 1 && (
              <div className="mb-2 border-b border-line pb-2">
                <p className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                  Pipeline
                </p>
                <div className="flex flex-wrap gap-1">
                  {pipelines.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onPipelineChange(p.id);
                        closeMenu();
                      }}
                      className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                        pipelineId === p.id
                          ? "bg-accent-soft text-accent"
                          : "bg-mist/[0.05] text-ink-soft hover:text-ink"
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-1 flex items-center justify-between px-1">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                Lagrede visninger
              </p>
              <button
                type="button"
                onClick={() => setShowSaveForm((v) => !v)}
                className="flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
              >
                <Plus size={11} />
                Lagre gjeldende
              </button>
            </div>

            {showSaveForm && (
              <div className="mb-1.5 flex items-center gap-1.5 px-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                  placeholder="Navn på visningen …"
                  className="field !py-1 text-[12px]"
                />
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !name.trim()}
                  className="btn btn-secondary shrink-0 !px-2.5 !py-1 text-[12px]"
                >
                  Lagre
                </button>
              </div>
            )}
            {error && <p className="mb-1.5 px-1 text-[11.5px] text-danger">{error}</p>}

            <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
              {loading && !views && (
                <li className="px-2 py-1.5 text-[12px] text-ink-faint">Laster …</li>
              )}
              {views?.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] text-ink-faint">
                  Ingen lagrede visninger ennå.
                </li>
              )}
              {views?.map((v) => (
                <li
                  key={v.id}
                  className="group flex items-center gap-1 rounded-lg hover:bg-mist/[0.05]"
                >
                  <Link
                    href={`/leads/visning/${v.slug}`}
                    onClick={closeMenu}
                    className="flex-1 truncate px-2 py-1.5 text-[12.5px]"
                  >
                    {v.name}
                    {v.createdByName && (
                      <span className="ml-1.5 text-[10.5px] text-ink-faint">
                        · {v.createdByName}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(v.id)}
                    title="Slett visning"
                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
