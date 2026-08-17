"use client";

import { useState } from "react";
import { X, ThumbsDown } from "lucide-react";

export interface LostReasonOption {
  id: number;
  label: string;
}

export default function LostReasonDialog({
  reasons,
  dealCount = 1,
  pending,
  onConfirm,
  onCancel,
}: {
  reasons: LostReasonOption[];
  dealCount?: number;
  pending?: boolean;
  onConfirm: (lostReasonId: number, comment: string) => void;
  onCancel: () => void;
}) {
  const [reasonId, setReasonId] = useState<number | "">("");
  const [comment, setComment] = useState("");

  function confirm() {
    if (!reasonId) return;
    onConfirm(Number(reasonId), comment);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 py-[12vh] backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-md p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-danger/10 text-danger">
              <ThumbsDown size={15} />
            </span>
            <h2 className="text-lg font-semibold tracking-tight">
              {dealCount > 1 ? `Marker ${dealCount} deals som tapt` : "Marker deal som tapt"}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
          Grunn <span className="text-danger">*</span>
        </label>
        <select
          value={reasonId}
          onChange={(e) => setReasonId(e.target.value ? Number(e.target.value) : "")}
          autoFocus
          className="field mb-4 w-full"
        >
          <option value="">Velg grunn …</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>

        <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
          Kommentar (valgfritt)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Legges til på kommentarfeltet og i notater/aktiviteter …"
          className="field mb-5 w-full resize-none"
        />

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">
            Avbryt
          </button>
          <button
            onClick={confirm}
            disabled={!reasonId || pending}
            className="btn btn-primary flex-1"
          >
            Bekreft
          </button>
        </div>
      </div>
    </div>
  );
}
