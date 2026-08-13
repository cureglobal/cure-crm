"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({
  href,
  label,
  icon,
  collapsed,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "bg-mist/[0.06] text-ink"
          : "text-ink-soft hover:bg-mist/[0.04] hover:text-ink"
      }`}
    >
      {icon}
      {!collapsed && label}
      {collapsed && (
        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-chip-dark px-2 py-1 text-[12px] font-medium text-white opacity-0 shadow-card transition-opacity duration-100 group-hover:opacity-100">
          {label}
        </span>
      )}
    </Link>
  );
}
