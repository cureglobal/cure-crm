"use client";

import { useState, useTransition } from "react";
import {
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
  syncBusinessUnitFromBrreg,
  autoMatchBusinessUnit,
  type BusinessUnitBrregSummary,
} from "@/lib/actions";
import { Plus, Trash2, Wand2, BadgeCheck } from "lucide-react";

export interface BusinessUnitRow {
  id: number;
  name: string;
  orgNumber: string | null;
  orgName: string | null;
  brregVerified: boolean;
  address: string | null;
  postalCode: string | null;
  city: string | null;
}

function UnitRow({
  unit,
  onSaveName,
  onSaveOrgNumber,
  onSynced,
  onRemove,
}: {
  unit: BusinessUnitRow;
  onSaveName: (id: number, name: string) => void;
  onSaveOrgNumber: (id: number, orgNumber: string) => void;
  onSynced: (id: number, summary: BusinessUnitBrregSummary) => void;
  onRemove: (id: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [orgNumber, setOrgNumber] = useState(unit.orgNumber ?? "");

  function sync() {
    setMessage(null);
    startTransition(async () => {
      const res = orgNumber.trim()
        ? await syncBusinessUnitFromBrreg(unit.id, orgNumber)
        : await autoMatchBusinessUnit(unit.id);
      if (res.unit) {
        // Adressen som nå vises under raden er en tydeligere bekreftelse enn
        // meldingsteksten, så vi lar den ta over i stedet for å vise begge.
        setMessage(null);
        setOrgNumber(res.unit.orgNumber);
        onSynced(unit.id, res.unit);
      } else {
        setMessage(res.message);
      }
    });
  }

  return (
    <li className="rounded-xl bg-mist/[0.03] px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          defaultValue={unit.name}
          onBlur={(e) => onSaveName(unit.id, e.target.value)}
          placeholder="Navn"
          className="field !flex-1 !border-transparent !bg-transparent !px-2 !py-1 text-[13.5px] font-medium hover:!border-line focus:!border-accent focus:!bg-surface"
        />
        <input
          value={orgNumber}
          onChange={(e) => setOrgNumber(e.target.value)}
          onBlur={(e) => onSaveOrgNumber(unit.id, e.target.value)}
          placeholder="Org.nr"
          inputMode="numeric"
          className="field !w-32 !py-1 text-[12.5px]"
        />
        <button
          onClick={sync}
          disabled={pending}
          title={orgNumber.trim() ? "Hent fra Enhetsregisteret" : "Prøv å matche på navn"}
          className="btn btn-secondary shrink-0 !py-1 !text-[12px]"
        >
          <Wand2 size={12} />
          {pending ? "Henter …" : "Match Brreg"}
        </button>
        {unit.brregVerified && (
          <span title="Bekreftet mot Enhetsregisteret" className="shrink-0 text-success-ink">
            <BadgeCheck size={16} />
          </span>
        )}
        <button
          onClick={() => onRemove(unit.id)}
          title="Slett selskap"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {(unit.brregVerified || message) && (
        <p className="mt-1.5 pl-2 text-[11.5px] text-ink-soft">
          {message ??
            [unit.orgName, unit.address, [unit.postalCode, unit.city].filter(Boolean).join(" ")]
              .filter(Boolean)
              .join(" · ")}
        </p>
      )}
    </li>
  );
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

  function saveOrgNumber(id: number, orgNumber: string) {
    const trimmed = orgNumber.replace(/\D/g, "");
    const current = units.find((u) => u.id === id);
    if (trimmed === (current?.orgNumber ?? "")) return;
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, orgNumber: trimmed || null } : u)));
    const fd = new FormData();
    fd.set("orgNumber", trimmed);
    startTransition(() => updateBusinessUnit(id, fd));
  }

  function applySynced(id: number, summary: BusinessUnitBrregSummary) {
    setUnits((prev) =>
      prev.map((u) =>
        u.id === id
          ? {
              ...u,
              orgNumber: summary.orgNumber,
              orgName: summary.orgName,
              brregVerified: true,
              address: summary.address,
              postalCode: summary.postalCode,
              city: summary.city,
            }
          : u
      )
    );
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
        setUnits((prev) => [
          ...prev,
          {
            id: created.id,
            name: created.name,
            orgNumber: null,
            orgName: null,
            brregVerified: false,
            address: null,
            postalCode: null,
            city: null,
          },
        ]);
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
          <UnitRow
            key={u.id}
            unit={u}
            onSaveName={saveName}
            onSaveOrgNumber={saveOrgNumber}
            onSynced={applySynced}
            onRemove={remove}
          />
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
