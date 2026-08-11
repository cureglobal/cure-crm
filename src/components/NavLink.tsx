"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition ${
        active
          ? "bg-black/[0.06] text-ink"
          : "text-ink-soft hover:bg-black/[0.04] hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}
