"use client";

import { useTransition } from "react";
import { deletePerson } from "@/lib/actions";
import { Trash2 } from "lucide-react";

export default function DeletePersonButton({
  personId,
  name,
}: {
  personId: number;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm(`Slette ${name}? Personen fjernes fra alle selskaper.`)) {
          startTransition(async () => {
            await deletePerson(personId);
          });
        }
      }}
      className="btn btn-danger"
    >
      <Trash2 size={14} />
      Slett person
    </button>
  );
}
