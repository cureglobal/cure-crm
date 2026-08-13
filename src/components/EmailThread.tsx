"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import { ArrowDownLeft, ArrowUpRight, ChevronDown } from "lucide-react";

interface ThreadMessage {
  id: number;
  direction: string;
  subject: string | null;
  fromAddr: string | null;
  toAddr: string | null;
  snippet: string | null;
  bodyText: string | null;
  sentAt: number | null;
}

function MessageRow({ message }: { message: ThreadMessage }) {
  const [open, setOpen] = useState(false);
  const outgoing = message.direction === "out";
  return (
    <li className="rounded-xl border border-line bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            outgoing ? "bg-accent-soft text-accent" : "bg-mist/[0.05] text-ink-soft"
          }`}
        >
          {outgoing ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{message.subject || "(uten emne)"}</p>
          <p className="truncate text-[12px] text-ink-soft">
            {outgoing ? `Til ${message.toAddr}` : `Fra ${message.fromAddr}`}
            {message.sentAt ? ` · ${formatDateTime(new Date(message.sentAt))}` : ""}
          </p>
        </div>
        <ChevronDown
          size={14}
          className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
            {message.bodyText || message.snippet || "(tomt innhold)"}
          </p>
        </div>
      )}
    </li>
  );
}

export default function EmailThread({
  ownerName,
  messages,
}: {
  ownerName: string | null;
  messages: ThreadMessage[];
}) {
  return (
    <div>
      {ownerName && (
        <p className="mb-2 text-[12px] font-medium text-ink-soft">
          {ownerName}s dialog (delt med deg)
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </ul>
    </div>
  );
}
