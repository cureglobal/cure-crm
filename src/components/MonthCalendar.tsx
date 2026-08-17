"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CalendarDeal {
  id: number;
  title: string;
  companyName: string;
  followUpAt: number; // ms epoch
}

const WEEKDAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const MONTH_NAMES = [
  "Januar", "Februar", "Mars", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Desember",
];

function dateKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MonthCalendar({ deals }: { deals: CalendarDeal[] }) {
  const [monthStart, setMonthStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const dealsByDay = useMemo(() => {
    const map = new Map<string, CalendarDeal[]>();
    for (const d of deals) {
      const key = dateKey(new Date(d.followUpAt));
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return map;
  }, [deals]);

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

  const todayKey = dateKey(new Date());

  return (
    <section className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold tracking-tight">
          {MONTH_NAMES[monthStart.getMonth()]} {monthStart.getFullYear()}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            title="Forrige måned"
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition hover:bg-mist/[0.06] hover:text-ink"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            title="Neste måned"
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition hover:bg-mist/[0.06] hover:text-ink"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = dateKey(day);
          const inMonth = day.getMonth() === monthStart.getMonth();
          const items = dealsByDay.get(key) ?? [];
          const hasDeadline = items.length > 0;
          const isToday = key === todayKey;
          return (
            <div key={key} className="relative">
              <Link
                href={`/leads?view=liste&dato=egendefinert&fra=${key}&til=${key}`}
                onMouseEnter={() => setHoverKey(key)}
                onMouseLeave={() => setHoverKey((k) => (k === key ? null : k))}
                className={`flex aspect-square items-center justify-center rounded-full text-[12.5px] transition ${
                  inMonth ? "text-ink" : "text-ink-faint/50"
                } ${hasDeadline ? "font-semibold ring-2 ring-accent" : ""} ${
                  isToday ? "bg-accent-soft" : "hover:bg-mist/[0.05]"
                }`}
              >
                {day.getDate()}
              </Link>
              {hoverKey === key && hasDeadline && (
                <div className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 w-56 -translate-x-1/2 rounded-xl border border-line bg-surface p-2.5 shadow-pop">
                  <ul className="flex flex-col gap-1">
                    {items.slice(0, 3).map((d) => (
                      <li key={d.id} className="truncate text-[12px]">
                        <span className="font-medium">{d.companyName}</span>{" "}
                        <span className="text-ink-soft">· {d.title}</span>
                      </li>
                    ))}
                  </ul>
                  {items.length > 3 && (
                    <p className="mt-1 text-[11px] text-ink-faint">
                      +{items.length - 3} flere
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
