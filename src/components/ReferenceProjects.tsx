"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { createReferenceProject, deleteReferenceProject } from "@/lib/actions";
import { PHASES } from "@/lib/estimator";
import { ChevronDown, ImagePlus, Plus, Trash2, X } from "lucide-react";

export interface ReferenceProjectData {
  id: number;
  name: string;
  url: string | null;
  notes: string | null;
  screenshot: string | null;
  phaseHours: Record<string, { estimert?: number; faktisk?: number }>;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — romslig, men et tak

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onFile(file: File) {
    setImageError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Bildet er over 5 MB — velg et mindre skjermbilde.");
      return;
    }
    setScreenshot(await readFileAsDataUrl(file));
  }

  return (
    <form
      ref={formRef}
      action={(data: FormData) => {
        if (screenshot) data.set("screenshot", screenshot);
        startTransition(async () => {
          await createReferenceProject(data);
          onDone();
        });
      }}
      className="card flex flex-col gap-3 p-5"
    >
      <div className="grid grid-cols-2 gap-2">
        <input name="name" required autoFocus placeholder="Prosjektnavn" className="field" />
        <input name="url" placeholder="Nettside (valgfritt)" className="field" />
      </div>
      <textarea
        name="notes"
        rows={2}
        placeholder="Notat — hva kjennetegnet prosjektet? (valgfritt)"
        className="field resize-none"
      />

      <div>
        {screenshot ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshot}
              alt="Skjermbilde"
              className="h-24 w-auto rounded-lg border border-line object-cover"
            />
            <button
              type="button"
              onClick={() => setScreenshot(null)}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-white shadow-card"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-soft transition hover:bg-black/[0.02]">
            <ImagePlus size={14} />
            Last opp skjermbilde (valgfritt)
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
        )}
        {imageError && <p className="mt-1 text-[12px] text-danger">{imageError}</p>}
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium text-ink-soft">
          Timer per fase (valgfritt — fyll inn det du husker)
        </p>
        <div className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-x-3 gap-y-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Fase
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Estimert
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Faktisk
          </span>
          {PHASES.map((p) => (
            <Fragment key={p.key}>
              <span className="text-[13px]">{p.label}</span>
              <input
                name={`est_${p.key}`}
                inputMode="decimal"
                placeholder="t"
                className="field !py-1 text-[13px]"
              />
              <input
                name={`act_${p.key}`}
                inputMode="decimal"
                placeholder="t"
                className="field !py-1 text-[13px]"
              />
            </Fragment>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Lagrer …" : "Lagre referanseprosjekt"}
        </button>
        <button type="button" onClick={onDone} className="btn btn-secondary">
          Avbryt
        </button>
      </div>
    </form>
  );
}

export default function ReferenceProjects({ items }: { items: ReferenceProjectData[] }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <section className="card p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronDown
          size={15}
          className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
        <h2 className="text-[15px] font-semibold tracking-tight">Referanseprosjekter</h2>
        <span className="text-[12.5px] text-ink-faint">{items.length}</span>
        <span className="ml-auto text-[12.5px] text-ink-soft">
          Brukes til å varsle om faser som pleier å sprekke
        </span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          {items.length === 0 && !adding && (
            <p className="text-[13px] text-ink-faint">
              Ingen referanseprosjekter ennå. Legg inn kjente, lignende prosjekter for å få
              varsel når et fase-estimat pleier å sprekke.
            </p>
          )}

          {items.map((item) => {
            const phaseCount = Object.keys(item.phaseHours).length;
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-xl border border-line p-3"
              >
                {item.screenshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.screenshot}
                    alt=""
                    className="h-14 w-20 shrink-0 rounded-lg border border-line object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-[11px] text-ink-faint">
                    Ingen bilde
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{item.name}</p>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-[12px] text-accent hover:underline"
                    >
                      {item.url}
                    </a>
                  )}
                  {item.notes && (
                    <p className="mt-0.5 truncate text-[12px] text-ink-soft">{item.notes}</p>
                  )}
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    {phaseCount > 0
                      ? `${phaseCount} ${phaseCount === 1 ? "fase" : "faser"} med tall`
                      : "Ingen fasetall registrert"}
                  </p>
                </div>
                <button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await deleteReferenceProject(item.id);
                    })
                  }
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}

          {adding ? (
            <AddForm onDone={() => setAdding(false)} />
          ) : (
            <button onClick={() => setAdding(true)} className="btn btn-ghost self-start">
              <Plus size={14} />
              Legg til referanseprosjekt
            </button>
          )}
        </div>
      )}
    </section>
  );
}
