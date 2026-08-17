"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Kort format uten årstall (f.eks. "17. aug") — plass er trangt i listevisningen.
function formatShort(d: Date) {
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

const WEEKDAYS = ["M", "T", "O", "T", "F", "L", "S"];
const MONTH_NAMES = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];

function parseDateStr(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Kompakt datovelger i appens eget design — erstatter <input type="date">,
// som viser nettleserens native kalender-popup uansett hvor i feltet man
// klikker (ikke bare på ikonet), og som ikke kan restyles til å matche resten.
export default function DateField({
  value,
  onChange,
  className = "",
  overdue = false,
}: {
  value: string; // yyyy-mm-dd, eller "" for ingen dato
  onChange: (value: string) => void;
  className?: string;
  overdue?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateStr(value);
  const [monthStart, setMonthStart] = useState(() => {
    const base = selected ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const days = useMemo(() => {
    const firstWeekday = (monthStart.getDay() + 6) % 7; // mandag = 0
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - firstWeekday);
    const list: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      list.push(d);
    }
    return list;
  }, [monthStart]);

  const todayStr = toDateStr(new Date());

  function openPicker() {
    const base = selected ?? new Date();
    setMonthStart(new Date(base.getFullYear(), base.getMonth(), 1));
    setOpen(true);
  }

  function choose(d: Date) {
    onChange(toDateStr(d));
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className={`w-full truncate text-left ${className} ${overdue ? "!font-medium !text-danger" : ""}`}
      >
        {selected ? formatShort(selected) : "—"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-line bg-surface p-2.5 shadow-pop">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <button
                type="button"
                onClick={() => setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition hover:bg-mist/[0.06] hover:text-ink"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[12.5px] font-semibold">
                {MONTH_NAMES[monthStart.getMonth()]} {monthStart.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() => setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition hover:bg-mist/[0.06] hover:text-ink"
              >
                <ChevronRight size={13} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 pb-1 text-center text-[9.5px] font-medium uppercase tracking-wide text-ink-faint">
              {WEEKDAYS.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day) => {
                const key = toDateStr(day);
                const inMonth = day.getMonth() === monthStart.getMonth();
                const isSelected = key === value;
                const isToday = key === todayStr;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => choose(day)}
                    className={`flex aspect-square items-center justify-center rounded-full text-[11px] transition ${
                      inMonth ? "text-ink" : "text-ink-faint/50"
                    } ${
                      isSelected
                        ? "bg-accent font-semibold text-white"
                        : isToday
                          ? "bg-accent-soft"
                          : "hover:bg-mist/[0.05]"
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="mt-2 w-full rounded-lg py-1.5 text-center text-[12px] font-medium text-ink-soft transition hover:bg-mist/[0.05] hover:text-danger"
              >
                Fjern dato
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
