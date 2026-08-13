"use client";

import { useState, useTransition } from "react";
import { autoMatchAllCompanies } from "@/lib/actions";
import { Wand2 } from "lucide-react";

export default function BrregMatchAll({ unverified }: { unverified: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    checked: number;
    matched: number;
    unresolved: string[];
  } | null>(null);

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[12.5px] text-ink-soft">
        {unverified === 0
          ? "Alle selskaper er bekreftet mot Enhetsregisteret."
          : `${unverified} selskaper er ikke bekreftet ennå. Søket bruker navn og nettsidedomene, og lagrer bare treff det er sikkert på.`}
      </p>

      {unverified > 0 && (
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(null);
              setResult(await autoMatchAllCompanies());
            })
          }
          className="btn btn-secondary"
        >
          <Wand2 size={14} className={pending ? "animate-pulse" : ""} />
          {pending ? "Søker i Enhetsregisteret …" : `Match ${unverified} selskaper`}
        </button>
      )}

      {result && (
        <div className="w-full">
          <p className="rounded-xl bg-success/10 px-4 py-2.5 text-[13px] font-medium text-success-ink">
            {result.matched} av {result.checked} selskaper ble bekreftet.
          </p>
          {result.unresolved.length > 0 && (
            <div className="mt-2 rounded-xl bg-warning/10 px-4 py-2.5">
              <p className="text-[12.5px] font-medium text-warning-ink">
                Disse må bekreftes manuelt ({result.unresolved.length}):
              </p>
              <p className="mt-1 text-[12.5px] text-warning-ink">
                {result.unresolved.join(", ")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
