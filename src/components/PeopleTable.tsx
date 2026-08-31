"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  createPerson,
  updatePerson,
  bulkLinkPeopleToCompany,
  bulkDeletePeople,
  bulkAddPersonTag,
} from "@/lib/actions";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import BulkTagPicker from "@/components/BulkTagPicker";
import TagFilterPicker, {
  ALL_TAGS_FILTER,
  matchesTagFilter,
  type TagFilterValue,
} from "@/components/TagFilterPicker";
import { useRangeToggle } from "@/lib/useRangeToggle";
import { ArrowDown, ArrowUp, Mail, Phone, Plus, Search, Trash2, X } from "lucide-react";

export interface PersonRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  companies: { id: number; name: string; logoUrl: string | null; role: string | null }[];
  tagIds: number[];
}

const GRID = "grid grid-cols-[22px_1.5fr_1.4fr_1fr_1.8fr] items-center gap-3";

type SortKey = "navn" | "epost" | "telefon" | "selskap";
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  navn: 1,
  epost: 1,
  telefon: 1,
  selskap: -1,
};

function HeaderCell({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 } | null;
  onSort: (k: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition hover:text-ink ${
        active ? "text-ink" : "text-ink-faint"
      }`}
    >
      {label}
      {active &&
        (sort!.dir === 1 ? (
          <ArrowUp size={11} strokeWidth={2.5} />
        ) : (
          <ArrowDown size={11} strokeWidth={2.5} />
        ))}
    </button>
  );
}

function PersonRowItem({
  person,
  selected,
  onToggle,
}: {
  person: PersonRow;
  selected: boolean;
  onToggle: (shiftKey: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function save(field: string, value: string) {
    const data = new FormData();
    data.set(field, value);
    startTransition(async () => {
      await updatePerson(person.id, data);
    });
  }

  const inputClass =
    "field !border-transparent !bg-transparent !px-2 !py-1.5 text-[13px] hover:!border-line focus:!border-accent focus:!bg-surface";

  return (
    <li className={`group border-b border-line last:border-b-0 ${pending ? "opacity-60" : ""}`}>
      <div className={`${GRID} px-5 py-2.5 transition hover:bg-mist/[0.015]`}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          onClick={(e) => onToggle(e.shiftKey)}
          className={`h-3.5 w-3.5 transition-opacity ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
        <Link href={`/people/${person.id}`} className="flex min-w-0 items-center gap-3">
          <Avatar name={person.name} size={32} />
          <span className="truncate text-[13.5px] font-medium hover:text-accent">
            {person.name}
          </span>
        </Link>

        <span className="flex items-center gap-1.5">
          <Mail size={12} className="shrink-0 text-ink-faint" />
          <input
            defaultValue={person.email ?? ""}
            placeholder="Legg til e-post"
            onBlur={(e) => {
              const v = e.target.value.trim().toLowerCase();
              if (v !== (person.email ?? "")) save("email", v);
            }}
            className={`${inputClass} text-ink-soft`}
          />
        </span>

        <span className="flex items-center gap-1.5">
          <Phone size={12} className="shrink-0 text-ink-faint" />
          <input
            defaultValue={person.phone ?? ""}
            placeholder="Telefon"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (person.phone ?? "")) save("phone", v);
            }}
            className={`${inputClass} text-ink-soft`}
          />
        </span>

        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {person.companies.length === 0 ? (
            <span className="text-[12.5px] text-ink-faint">Ingen selskap</span>
          ) : (
            person.companies.map((c) => (
              <Link
                key={c.id}
                href={`/companies/${c.id}`}
                title={c.role ?? undefined}
                className="flex max-w-full items-center gap-1.5 rounded-full bg-mist/[0.05] py-0.5 pl-0.5 pr-2.5 text-[12px] font-medium transition hover:bg-accent-soft hover:text-accent"
              >
                <CompanyLogo logoUrl={c.logoUrl} name={c.name} size={18} radius={9} />
                <span className="truncate">{c.name}</span>
              </Link>
            ))
          )}
        </span>
      </div>
    </li>
  );
}

export default function PeopleTable({
  rows,
  companies,
  tags,
}: {
  rows: PersonRow[];
  companies: { id: number; name: string }[];
  tags: { id: number; label: string }[];
}) {
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<TagFilterValue>(ALL_TAGS_FILTER);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>({
    key: "navn",
    dir: 1,
  });
  const [showNew, setShowNew] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [companyChoice, setCompanyChoice] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  function onSort(key: SortKey) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: DEFAULT_DIR[key] }
    );
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? rows.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.email ?? "").toLowerCase().includes(q) ||
            (p.phone ?? "").toLowerCase().includes(q) ||
            p.companies.some((c) => c.name.toLowerCase().includes(q))
        )
      : rows;
    if (tagFilter.ids.length > 0) {
      list = list.filter((p) => matchesTagFilter(p.tagIds, tagFilter));
    }
    if (sort) {
      const dir = sort.dir;
      list = [...list].sort((a, b) => {
        switch (sort.key) {
          case "navn":
            return dir * a.name.localeCompare(b.name, "nb");
          case "epost":
            return dir * (a.email ?? "").localeCompare(b.email ?? "", "nb");
          case "telefon":
            return dir * (a.phone ?? "").localeCompare(b.phone ?? "", "nb");
          case "selskap":
            return dir * (a.companies.length - b.companies.length);
        }
      });
    }
    return list;
  }, [rows, search, tagFilter, sort]);

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of visible) next.delete(p.id);
      } else {
        for (const p of visible) next.add(p.id);
      }
      return next;
    });
  }

  const toggleOne = useRangeToggle(setSelected, visible);

  function clearSelection() {
    setSelected(new Set());
    setConfirmingDelete(false);
    setBulkMessage(null);
  }

  function applyLinkToCompany() {
    if (!companyChoice) return;
    const ids = [...selected];
    const companyId = Number(companyChoice);
    startTransition(async () => {
      await bulkLinkPeopleToCompany(ids, companyId);
      setBulkMessage(`Knyttet ${ids.length} personer til selskapet.`);
    });
  }

  function applyDelete() {
    const ids = [...selected];
    startTransition(async () => {
      await bulkDeletePeople(ids);
      clearSelection();
    });
  }

  function applyBulkTags(tagIds: number[]) {
    const ids = [...selected];
    startTransition(async () => {
      for (const tagId of tagIds) {
        await bulkAddPersonTag(ids, tagId);
      }
      setBulkMessage(`Tagget ${ids.length} personer.`);
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-[280px]">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Søk i navn, e-post eller selskap …"
            className="field !rounded-full !py-1.5 !pl-8 text-[12.5px]"
          />
        </div>
        {tags.length > 0 && (
          <TagFilterPicker tags={tags} value={tagFilter} onChange={setTagFilter} />
        )}
        <button onClick={() => setShowNew((v) => !v)} className="btn btn-primary ml-auto">
          <Plus size={15} strokeWidth={2.2} />
          Ny person
        </button>
      </div>

      {showNew && (
        <form
          action={(data: FormData) => {
            startTransition(async () => {
              await createPerson(data);
              setShowNew(false);
            });
          }}
          className="card mb-4 flex flex-col gap-2.5 p-5"
        >
          <div className="flex items-start justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight">Ny person</h2>
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/5"
            >
              <X size={15} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="name" required autoFocus placeholder="Navn" className="field" />
            <input name="email" type="email" placeholder="E-post" className="field" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input name="phone" placeholder="Telefon" className="field" />
            <select name="companyId" defaultValue="" className="field">
              <option value="">Uten selskap</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input name="role" placeholder="Rolle" className="field" />
          </div>
          <button type="submit" disabled={pending} className="btn btn-primary self-start">
            {pending ? "Lagrer …" : "Opprett person"}
          </button>
        </form>
      )}

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-3">
          <span className="text-[13px] font-medium">{selected.size} valgt</span>

          <select
            value={companyChoice}
            onChange={(e) => setCompanyChoice(e.target.value)}
            className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
          >
            <option value="">Knytt til selskap …</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={applyLinkToCompany}
            disabled={pending || !companyChoice}
            className="btn btn-secondary !py-1.5"
          >
            Bruk
          </button>

          <BulkTagPicker tags={tags} disabled={pending} onApply={applyBulkTags} />

          {confirmingDelete ? (
            <span className="flex items-center gap-2 rounded-full bg-danger/10 px-3 py-1.5">
              <span className="text-[12.5px] text-danger">Slette {selected.size} personer?</span>
              <button onClick={applyDelete} disabled={pending} className="btn btn-danger !py-1">
                Ja, slett
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-[12.5px] font-medium text-ink-soft hover:text-ink"
              >
                Avbryt
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              className="btn btn-danger !py-1.5"
            >
              <Trash2 size={13} />
              Slett
            </button>
          )}

          {bulkMessage && <span className="text-[12.5px] text-ink-soft">{bulkMessage}</span>}

          <button
            onClick={clearSelection}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-mist/[0.06]"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="card overflow-auto max-h-[75vh]">
        <div className="min-w-[700px]">
          <div
            className={`${GRID} sticky top-0 z-20 rounded-t-[17px] border-b border-line bg-surface/95 px-5 py-2.5 backdrop-blur-xl`}
          >
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5"
            />
            <HeaderCell label="Navn" sortKey="navn" sort={sort} onSort={onSort} />
            <span className="px-2">
              <HeaderCell label="E-post" sortKey="epost" sort={sort} onSort={onSort} />
            </span>
            <span className="px-2">
              <HeaderCell label="Telefon" sortKey="telefon" sort={sort} onSort={onSort} />
            </span>
            <HeaderCell label="Selskap" sortKey="selskap" sort={sort} onSort={onSort} />
          </div>

          {visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-ink-faint">
              {rows.length === 0
                ? "Ingen personer ennå. Legg til den første med «Ny person»."
                : "Ingen personer matcher søket."}
            </p>
          ) : (
            <ul>
              {visible.map((p, i) => (
                <PersonRowItem
                  key={p.id}
                  person={p}
                  selected={selected.has(p.id)}
                  onToggle={(shiftKey) => toggleOne(p.id, i, shiftKey)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
