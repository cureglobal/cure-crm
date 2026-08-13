"use client";

import { useState, useTransition } from "react";
import { updateCompany } from "@/lib/actions";
import { formatOrgNumber } from "@/components/CompanyFacts";
import { UserRound } from "lucide-react";

export default function CompanyEditForm({
  company,
  people,
  users,
}: {
  company: {
    id: number;
    name: string;
    orgName: string | null;
    orgNumber: string | null;
    website: string | null;
    phone: string | null;
    primaryContactId: number | null;
    ownerId: number | null;
  };
  people: { id: number; name: string }[];
  users: { id: number; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <section className="card p-6">
      <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Rediger selskap</h2>
      <form
        action={(data: FormData) => {
          startTransition(async () => {
            setSaved(false);
            await updateCompany(company.id, data);
            setSaved(true);
          });
        }}
        className="flex flex-col gap-2.5"
      >
        <label className="text-[12px] font-medium text-ink-soft">
          Navn (kallenavn)
          <input name="name" defaultValue={company.name} className="field mt-1" />
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          Org. navn
          <input
            key={company.orgName ?? "tomt"}
            name="orgName"
            defaultValue={company.orgName ?? ""}
            placeholder="Hentes fra Enhetsregisteret"
            className="field mt-1"
          />
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          Organisasjonsnummer
          <input
            key={company.orgNumber ?? "tomt"}
            name="orgNumber"
            defaultValue={formatOrgNumber(company.orgNumber)}
            placeholder="9 siffer"
            inputMode="numeric"
            className="field mt-1"
          />
          <span className="mt-1 block font-normal text-[11.5px] text-ink-faint">
            Endrer du dette, hentes firmainfo på nytt og selskapet blir bekreftet.
          </span>
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          <span className="flex items-center gap-1.5">
            <UserRound size={12} />
            Eier av kunden
          </span>
          <select
            key={company.ownerId ?? "ingen"}
            name="ownerId"
            defaultValue={company.ownerId ? String(company.ownerId) : ""}
            className="field mt-1"
          >
            <option value="">Ingen valgt</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          Nettside
          <input
            name="website"
            defaultValue={company.website ?? ""}
            placeholder="https://firma.no"
            className="field mt-1"
          />
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          Telefon
          <input
            name="phone"
            defaultValue={company.phone ?? ""}
            placeholder="902 87 168"
            className="field mt-1"
          />
        </label>
        <label className="text-[12px] font-medium text-ink-soft">
          <span className="flex items-center gap-1.5">
            <UserRound size={12} />
            Hovedkontakt
          </span>
          {/* key tvinger remount når serveren har lagret, ellers henger
              det gamle valget igjen i den ukontrollerte select-en. */}
          <select
            key={company.primaryContactId ?? "none"}
            name="primaryContactId"
            defaultValue={company.primaryContactId ? String(company.primaryContactId) : ""}
            className="field mt-1"
          >
            <option value="">Ingen valgt</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {people.length === 0 && (
          <p className="text-[12px] text-ink-faint">
            Legg til personer på selskapet for å kunne velge hovedkontakt.
          </p>
        )}
        <p className="text-[12px] text-ink-faint">
          Legger du inn nettsiden, hentes logoen automatisk.
        </p>
        <div className="mt-1 flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn btn-secondary">
            {pending ? "Lagrer …" : "Lagre endringer"}
          </button>
          {saved && !pending && (
            <span className="text-[12.5px] font-medium text-success-ink">Lagret</span>
          )}
        </div>
      </form>
    </section>
  );
}
