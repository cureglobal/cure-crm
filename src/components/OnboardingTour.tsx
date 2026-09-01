"use client";

import { useState, useTransition, type ReactNode } from "react";
import { completeOnboarding } from "@/lib/actions";
import { Columns3, Building2, Settings, X, ArrowRight, ArrowLeft, PartyPopper } from "lucide-react";

interface Step {
  icon: ReactNode;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: <PartyPopper size={20} />,
    title: "Velkommen til Cure CRM",
    body: "En rask gjennomgang av det viktigste — tar under et minutt. Du kan hoppe over når som helst.",
  },
  {
    icon: <Columns3 size={20} />,
    title: "Pipeline",
    body: "Alle deals er organisert i faser. Bytt mellom Tavle (dra-og-slipp) og Liste øverst på siden. Faser kan legges til, redigeres, slettes og omorganiseres fritt under Innstillinger.",
  },
  {
    icon: <Building2 size={20} />,
    title: "Ny deal og ny bedrift",
    body: "«Ny deal»-knappen finnes på Oversikt og Pipeline — søk opp selskapet i Brønnøysundregisteret eller legg det inn manuelt. Bedrifter kan også opprettes direkte fra Bedrifter-siden.",
  },
  {
    icon: <Settings size={20} />,
    title: "Innstillinger",
    body: "Her styrer du design (lys, mørk eller ELGUIDE), pipeline-faser, e-postkobling, og hvem som er administrator.",
  },
];

export default function OnboardingTour({ show }: { show: boolean }) {
  const [open, setOpen] = useState(show);
  const [step, setStep] = useState(0);
  const [, startTransition] = useTransition();

  if (!open) return null;

  function finish() {
    setOpen(false);
    startTransition(() => completeOnboarding());
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="card w-full max-w-md p-6 shadow-pop">
        <div className="mb-4 flex items-start justify-between">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
            {current.icon}
          </span>
          <button
            onClick={finish}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
          >
            <X size={16} />
          </button>
        </div>

        <h2 className="mb-2 text-[17px] font-semibold tracking-tight">{current.title}</h2>
        <p className="mb-6 text-[13.5px] leading-relaxed text-ink-soft">{current.body}</p>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-accent" : "bg-mist/[0.15]"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep((s) => s - 1)} className="btn btn-secondary">
                <ArrowLeft size={13} />
                Tilbake
              </button>
            )}
            {isLast ? (
              <button onClick={finish} className="btn btn-primary">
                Kom i gang
              </button>
            ) : (
              <button onClick={() => setStep((s) => s + 1)} className="btn btn-primary">
                Neste
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
