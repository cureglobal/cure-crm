"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import {
  House,
  Columns3,
  Settings,
  LogOut,
  Building2,
  Contact,
  Calculator,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import NavLink from "@/components/NavLink";
import ImportDialog from "@/components/ImportDialog";
import type { Stage } from "@/lib/stages";

const STORAGE_KEY = "crm:sidebar-collapsed";
const WIDTH_OPEN = 240;
const WIDTH_COLLAPSED = 68;

export default function AppShell({
  user,
  logoutAction,
  stages,
  children,
}: {
  user: { name: string; email: string; avatarDataUrl: string | null };
  logoutAction: () => void | Promise<void>;
  stages: Stage[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Samme mønster som pipeline-filtrene (PipelineView.tsx): lagret preferanse
  // finnes bare i nettleseren, så den leses etter montering for å unngå
  // hydreringsavvik mot serverens HTML.
  /* eslint-disable react-hooks/set-state-in-effect -- synkroniserer med localStorage */
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Privat nettlesing e.l. — bruk standardverdien (åpen).
    }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Ikke kritisk — gjelder bare denne sesjonen.
    }
  }, [hydrated, collapsed]);

  const width = collapsed ? WIDTH_COLLAPSED : WIDTH_OPEN;

  return (
    <div className="flex min-h-screen">
      <aside
        className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-line bg-surface/70 backdrop-blur-xl transition-[width] duration-150"
        style={{ width }}
      >
        <div
          className={`flex items-center pb-4 pt-6 ${
            collapsed ? "flex-col gap-2 px-0" : "justify-between px-5"
          }`}
        >
          <Link href="/" className="flex items-center gap-2.5" title={collapsed ? "Cure CRM" : undefined}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-chip-dark text-[15px] font-semibold text-white">
              C
            </span>
            {!collapsed && (
              <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">
                Cure CRM
              </span>
            )}
          </Link>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Vis sidebar" : "Minimer sidebar"}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-mist/[0.06] hover:text-ink"
          >
            {collapsed ? (
              <PanelLeftOpen size={14} strokeWidth={1.8} />
            ) : (
              <PanelLeftClose size={14} strokeWidth={1.8} />
            )}
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          <NavLink
            href="/"
            label="Oversikt"
            icon={<House size={17} strokeWidth={1.8} />}
            collapsed={collapsed}
          />
          <NavLink
            href="/leads"
            label="Pipeline"
            icon={<Columns3 size={17} strokeWidth={1.8} />}
            collapsed={collapsed}
          />
          <NavLink
            href="/companies"
            label="Bedrifter"
            icon={<Building2 size={17} strokeWidth={1.8} />}
            collapsed={collapsed}
          />
          <NavLink
            href="/people"
            label="Personer"
            icon={<Contact size={17} strokeWidth={1.8} />}
            collapsed={collapsed}
          />
          <NavLink
            href="/estimat"
            label="Prisverktøy"
            icon={<Calculator size={17} strokeWidth={1.8} />}
            collapsed={collapsed}
          />
          <NavLink
            href="/settings"
            label="Innstillinger"
            icon={<Settings size={17} strokeWidth={1.8} />}
            collapsed={collapsed}
          />
        </nav>

        <div className="mt-auto px-3 pb-1">
          <ImportDialog collapsed={collapsed} stages={stages} />
        </div>

        <div className="border-t border-line p-3">
          <div className={`flex items-center gap-2.5 rounded-xl px-2 py-2 ${collapsed ? "justify-center" : ""}`}>
            <Avatar
              name={user.name}
              imageUrl={user.avatarDataUrl}
              size={32}
              title={collapsed ? `${user.name} · ${user.email}` : user.name}
            />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{user.name}</p>
                <p className="truncate text-[11.5px] text-ink-soft">{user.email}</p>
              </div>
            )}
            <form action={logoutAction}>
              <button
                type="submit"
                title="Logg ut"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-mist/5 hover:text-ink"
              >
                <LogOut size={15} strokeWidth={1.8} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* min-w-0 overstyrer flex-items' default min-width:auto — uten den nekter
          denne boksen å bli smalere enn tabellenes fulle innhold, og hele siden
          blir bredere i stedet for at tabellen scroller for seg selv. */}
      <main
        className="min-w-0 flex-1 px-10 py-8 transition-[margin-left] duration-150"
        style={{ marginLeft: width }}
      >
        {children}
      </main>
    </div>
  );
}
