"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationDTO,
} from "@/lib/actions";
import { relativeTimeAgo } from "@/lib/format";
import { Bell } from "lucide-react";

// Friskner opp den røde prikken jevnlig selv om siden ikke navigeres —
// varsler kan komme fra noen ANNET som gjør noe akkurat nå mens man sitter
// og ser på en helt annen side.
const POLL_MS = 45_000;

function NotificationText({ n }: { n: NotificationDTO }) {
  return (
    <p>
      <span className="font-medium">{n.actorName}</span> la deg til på{" "}
      {n.dealId != null && n.dealSlug ? (
        <>
          <Link
            href={`/leads/${n.dealSlug}`}
            className="font-medium text-accent hover:underline"
          >
            {n.dealTitle ?? "en deal"}
          </Link>
          {n.companyId != null && (
            <>
              {" "}
              for{" "}
              <Link
                href={`/companies/${n.companyId}`}
                className="font-medium text-accent hover:underline"
              >
                {n.companyName ?? "kunden"}
              </Link>
            </>
          )}
        </>
      ) : n.companyId != null ? (
        <Link
          href={`/companies/${n.companyId}`}
          className="font-medium text-accent hover:underline"
        >
          {n.companyName ?? "selskapet"}
        </Link>
      ) : (
        "noe"
      )}
      .
    </p>
  );
}

export default function NotificationBell({
  collapsed,
  initialUnreadCount,
}: {
  collapsed?: boolean;
  initialUnreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [items, setItems] = useState<NotificationDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const id = setInterval(() => {
      getUnreadNotificationCount().then(setUnreadCount);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  function openPopover() {
    setOpen(true);
    setLoading(true);
    listNotifications().then((rows) => {
      setItems(rows);
      setUnreadCount(rows.filter((r) => r.readAt == null).length);
      setLoading(false);
    });
  }

  function toggle() {
    if (open) setOpen(false);
    else openPopover();
  }

  function handleClickItem(id: number, alreadyRead: boolean) {
    if (alreadyRead) return;
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)) ?? prev);
    setUnreadCount((c) => Math.max(0, c - 1));
    startTransition(() => markNotificationRead(id));
  }

  function markAllRead() {
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? Date.now() })) ?? prev);
    setUnreadCount(0);
    startTransition(() => markAllNotificationsRead());
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        title="Varsler"
        className={`group relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium text-ink-soft transition hover:bg-mist/[0.04] hover:text-ink ${
          collapsed ? "justify-center" : "w-full"
        }`}
      >
        <span className="relative flex shrink-0 items-center justify-center">
          <Bell size={17} strokeWidth={1.8} />
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-danger px-[3px] text-[9px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </span>
        {!collapsed && "Varsler"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-40 w-80 max-w-[90vw] rounded-xl border border-line bg-surface p-2 shadow-pop ${
              collapsed ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-1.5"
            }`}
          >
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                Varsler
              </span>
              {items && items.some((n) => n.readAt == null) && (
                <button
                  onClick={markAllRead}
                  className="text-[11.5px] font-medium text-accent hover:underline"
                >
                  Merk alle som lest
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <p className="px-2 py-6 text-center text-[12.5px] text-ink-faint">Laster …</p>
              ) : !items || items.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12.5px] text-ink-faint">
                  Ingen varsler ennå.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {items.map((n) => (
                    <li
                      key={n.id}
                      onClick={() => handleClickItem(n.id, n.readAt != null)}
                      className={`rounded-lg px-2 py-2 text-[12.5px] leading-relaxed transition hover:bg-mist/[0.05] ${
                        n.readAt == null ? "bg-accent-soft/40" : ""
                      }`}
                    >
                      <NotificationText n={n} />
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {relativeTimeAgo(new Date(n.createdAt))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
