import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/lib/actions";
import { initials } from "@/lib/format";
import { House, Columns3, Settings, LogOut, Building2, Contact } from "lucide-react";
import NavLink from "@/components/NavLink";
import WonCelebration from "@/components/WonCelebration";
import ImportDialog from "@/components/ImportDialog";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-line bg-white/70 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2.5 px-5 pb-4 pt-6">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-ink text-[15px] font-semibold text-white">
            C
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Cure CRM</span>
        </Link>

        <nav className="flex flex-col gap-0.5 px-3">
          <NavLink href="/" label="Oversikt" icon={<House size={17} strokeWidth={1.8} />} />
          <NavLink
            href="/leads"
            label="Pipeline"
            icon={<Columns3 size={17} strokeWidth={1.8} />}
          />
          <NavLink
            href="/companies"
            label="Bedrifter"
            icon={<Building2 size={17} strokeWidth={1.8} />}
          />
          <NavLink
            href="/people"
            label="Personer"
            icon={<Contact size={17} strokeWidth={1.8} />}
          />
          <NavLink
            href="/settings"
            label="Innstillinger"
            icon={<Settings size={17} strokeWidth={1.8} />}
          />
        </nav>

        <div className="mt-auto px-3 pb-1">
          <ImportDialog />
        </div>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
              {initials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{user.name}</p>
              <p className="truncate text-[11.5px] text-ink-soft">{user.email}</p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                title="Logg ut"
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft transition hover:bg-black/5 hover:text-ink"
              >
                <LogOut size={15} strokeWidth={1.8} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="ml-60 flex-1 px-10 py-8">{children}</main>
      <WonCelebration />
    </div>
  );
}
