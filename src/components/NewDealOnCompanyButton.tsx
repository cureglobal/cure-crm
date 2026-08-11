"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createDealForCompany } from "@/lib/actions";
import { Plus, X } from "lucide-react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
      {pending ? "Oppretter …" : "Opprett deal"}
    </button>
  );
}

export default function NewDealOnCompanyButton({
  companyId,
  companyName,
}: {
  companyId: number;
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const action = createDealForCompany.bind(null, companyId);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <Plus size={15} strokeWidth={2.2} />
        Ny deal
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[16vh] backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-md p-6 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Ny deal</h2>
                <p className="mt-0.5 text-[13px] text-ink-soft">På {companyName}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-black/5"
              >
                <X size={16} />
              </button>
            </div>

            <form action={action} className="flex flex-col gap-3">
              <input
                name="dealTitle"
                required
                autoFocus
                placeholder="Hva gjelder dealen? (f.eks. Nettsider)"
                className="field"
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[12px] font-medium text-ink-soft">
                  Verdi (kr)
                  <input
                    name="value"
                    inputMode="numeric"
                    placeholder="Valgfritt"
                    className="field mt-1"
                  />
                </label>
                <label className="text-[12px] font-medium text-ink-soft">
                  Oppfølging
                  <input type="date" name="followUpAt" className="field mt-1" />
                </label>
              </div>
              <p className="text-[12px] text-ink-faint">
                Verdien kan også regnes ut fra varelinjer senere.
              </p>
              <SubmitButton />
            </form>
          </div>
        </div>
      )}
    </>
  );
}
