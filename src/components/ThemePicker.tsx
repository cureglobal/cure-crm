"use client";

import { useTransition } from "react";
import { updateTheme } from "@/lib/actions";
import { Check } from "lucide-react";

const THEMES = [
  {
    id: "lys",
    label: "Lys",
    desc: "Krem, sort og lime.",
    canvas: "#f7f4ec",
    surface: "#ffffff",
    accent: "#171717",
    font: "inherit",
  },
  {
    id: "dark",
    label: "Mørk",
    desc: "Mørke flater, lime aksent.",
    canvas: "#18181b",
    surface: "#232327",
    accent: "#d8fa60",
    font: "inherit",
  },
  {
    id: "elguide",
    label: "ELGUIDE",
    desc: "Retro butikksystem, monospace.",
    canvas: "#0000a0",
    surface: "#c0c0c0",
    accent: "#000000",
    font: "'Courier New', monospace",
  },
] as const;

export default function ThemePicker({ current }: { current: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid grid-cols-3 gap-3">
      {THEMES.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            disabled={pending}
            onClick={() => {
              const fd = new FormData();
              fd.set("theme", t.id);
              startTransition(() => updateTheme(fd));
            }}
            className={`flex flex-col overflow-hidden rounded-xl border text-left transition ${
              active ? "border-accent ring-1 ring-accent" : "border-line hover:border-ink-faint"
            }`}
          >
            <span
              className="flex h-16 items-center justify-center gap-1 px-3"
              style={{ background: t.canvas }}
            >
              <span
                className="h-8 flex-1 rounded-[6px]"
                style={{ background: t.surface }}
              />
              <span
                className="h-8 w-8 shrink-0 rounded-[6px]"
                style={{ background: t.accent }}
              />
            </span>
            <span className="flex items-center justify-between gap-2 px-3 py-2.5">
              <span>
                <span className="block text-[13px] font-medium" style={{ fontFamily: t.font }}>
                  {t.label}
                </span>
                <span className="block text-[11.5px] text-ink-soft">{t.desc}</span>
              </span>
              {active && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
                  <Check size={12} strokeWidth={2.5} />
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
