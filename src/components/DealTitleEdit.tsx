"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameDeal } from "@/lib/actions";

export default function DealTitleEdit({
  dealId,
  initialTitle,
}: {
  dealId: number;
  initialTitle: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function save(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialTitle) return;
    startTransition(async () => {
      const res = await renameDeal(dealId, trimmed);
      // Adressefeltet må følge det nye navnet, siden URL-en er bygget av det.
      if (res) router.replace(`/leads/${res.slug}`);
    });
  }

  return (
    <input
      defaultValue={initialTitle}
      onBlur={(e) => save(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="field !border-transparent !bg-transparent !px-1.5 !py-0.5 !-ml-1.5 text-[24px] font-semibold tracking-tight hover:!border-line focus:!border-accent focus:!bg-surface"
    />
  );
}
