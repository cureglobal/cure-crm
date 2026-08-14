"use client";

import { useState, useTransition } from "react";
import { createBusinessUnit, updateBusinessUnit, deleteBusinessUnit } from "@/lib/actions";
import { Plus, Trash2 } from "lucide-react";

export interface BusinessUnitRow {
  id: number;
  name: string;
}

export default function BusinessUnitsManager({ units: initial }: { units: BusinessUnitRow[] }) {
  const [units, setUnits] = useState(initial);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addPending, startAdd] = useTransition();

  function saveName(id: number, name: string) {
    const trimmed = name.trim();
    const current = units.find((u) => u.id === id);
    if (!trimmed || trimmed === current?.name) return;
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, name: trimmed } : u)));
    const fd = new FormData();
    fd.set("name", trimmed);
    startTransition(() => updateBusinessUnit(id, fd));
  }

  function remove(id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deleteBusinessUnit(id);
      if (res.ok) {
        setUnits((prev) => prev.filter((u) => u.id !== id));
      } else {
        setError(res.message);
      }
    });
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    startAdd(async () => {
      const created = await createBusinessUnit(fd);
      if (created) {
        setUnits((prev) => [...prev, { id: created.id, name: created.name }]);
      }
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {units.map((u) => (
          <li key={u.id} className="flex items-center gap-2 rounded-xl bg-mist/[0.03] px-3 py-2">
            <input
              defaultValue={u.name}
              onBlur={(e) => saveName(u.id, e.target.value)}
              className="field !flex-1 !border-transparent !bg-transparent !px-2 !py-1 text-[13.5px] font-medium hover:!border-line focus:!border-accent focus:!bg-surface"
            />
            <button
              onClick={() => remove(u.id)}
              title="Slett selskap"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Navn på nytt selskap …"
          className="field flex-1"
        />
        <button
          onClick={add}
          disabled={addPending || !newName.trim()}
          className="btn btn-secondary shrink-0"
        >
          <Plus size={14} />
          Legg til
        </button>
      </div>
    </div>
  );
}
