"use client";

import { useTransition } from "react";
import { exportPersonData } from "@/lib/actions";
import { Download } from "lucide-react";

// GDPR-innsyn: laster ned alt CRM-et har lagret om denne personen som en
// JSON-fil, direkte i nettleseren — samme nedlastingsmønster som
// ImportDialog sin malnedlasting.
export default function ExportPersonDataButton({
  personId,
  name,
}: {
  personId: number;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const data = await exportPersonData(personId);
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^\p{L}\p{N}]+/gu, "-")}-data.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <button onClick={download} disabled={pending} className="btn btn-secondary">
      <Download size={14} />
      {pending ? "Henter …" : "Eksporter data"}
    </button>
  );
}
