"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { formatDate, formatMoney, relativeDay } from "@/lib/format";
import CompanyLogo from "@/components/CompanyLogo";
import CompanyOwnerCell from "@/components/CompanyOwnerCell";
import MergeCompaniesDialog from "@/components/MergeCompaniesDialog";
import BulkTagPicker from "@/components/BulkTagPicker";
import TagFilterPicker, {
  ALL_TAGS_FILTER,
  matchesTagFilter,
  type TagFilterValue,
} from "@/components/TagFilterPicker";
import { useRangeToggle } from "@/lib/useRangeToggle";
import {
  bulkDeleteCompanies,
  bulkSetCompanyOwner,
  bulkSetCompanyBusinessUnit,
  bulkMatchCompaniesBrreg,
  bulkAddCompanyTag,
  getCompaniesForMerge,
  mergeCompanies,
  type MergeCandidate,
} from "@/lib/actions";
import {
  ArrowDown,
  ArrowUp,
  Search,
  Users,
  Briefcase,
  TrendingUp,
  TriangleAlert,
  Trash2,
  Wand2,
  GitMerge,
  X,
} from "lucide-react";

export interface CompanyRow {
  id: number;
  name: string;
  orgName: string | null;
  orgNumber: string | null;
  brregVerified: boolean;
  logoUrl: string | null;
  website: string | null;
  dealCount: number;
  openCount: number;
  ownerId: number | null;
  ownerName: string;
  ownerAvatarUrl: string | null;
  coOwnerIds: number[];
  people: string[];
  tagIds: number[];
  createdAt: number;
  // Nyeste av manuelt loggført kontakt og synket e-post. Null skal i praksis
  // ikke forekomme etter engangs-etterkoblingen i migrate.ts (alle selskap
  // uten aktivitet fikk en syntetisk rad datert 1.1.2025), men håndteres
  // likevel defensivt.
  lastContactAt: number | null;
}

const GRID = "grid grid-cols-[22px_1.4fr_100px_70px_90px_1fr_90px_100px] items-center gap-3";

type SortKey = "navn" | "orgnr" | "deals" | "eier" | "personer" | "lagttil" | "sistkontakt";
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  navn: 1,
  orgnr: 1,
  deals: -1,
  eier: 1,
  personer: -1,
  lagttil: -1,
  // Stigende først — de vi IKKE har snakket med på lengst tid øverst, siden
  // det er nettopp de kundene kolonnen skal minne oss på.
  sistkontakt: 1,
};

// Terskler for å visuelt fremheve selskap vi ikke har snakket med på en
// stund — samme idé som relativeDay sin tone, men egen skala siden "Sist
// kontakt" alltid er en fortidsdato (relativeDay sin overdue-tone alene gir
// ingen forskjell mellom 3 og 300 dager siden).
function contactToneClass(days: number): string {
  if (days > 180) return "text-danger";
  if (days > 90) return "text-warning-ink";
  return "text-ink-soft";
}

function daysSince(ms: number): number {
  return Math.floor((Date.now() - ms) / 86_400_000);
}

function formatOrgNumber(org: string | null): string {
  if (!org) return "";
  return org.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

function HeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 } | null;
  onSort: (k: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition hover:text-ink ${
        active ? "text-ink" : "text-ink-faint"
      } ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : ""}`}
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

export default function CompaniesTable({
  rows,
  totalOpen,
  totalWon,
  owners,
  businessUnits,
  tags,
}: {
  rows: CompanyRow[];
  totalOpen: number;
  totalWon: number;
  owners: { id: number; name: string; avatarDataUrl: string | null }[];
  businessUnits: { id: number; name: string }[];
  tags: { id: number; label: string }[];
}) {
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<TagFilterValue>(ALL_TAGS_FILTER);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>({
    key: "navn",
    dir: 1,
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [ownerChoice, setOwnerChoice] = useState("");
  const [businessUnitChoice, setBusinessUnitChoice] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[] | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergePending, startMergeTransition] = useTransition();
  const [mergeError, setMergeError] = useState<string | null>(null);

  function onSort(key: SortKey) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: DEFAULT_DIR[key] }
    );
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.orgName ?? "").toLowerCase().includes(q) ||
            (r.orgNumber ?? "").replace(/\s/g, "").includes(q.replace(/\s/g, "")) ||
            r.people.some((p) => p.toLowerCase().includes(q))
        )
      : rows;
    if (tagFilter.ids.length > 0) {
      list = list.filter((r) => matchesTagFilter(r.tagIds, tagFilter));
    }
    if (sort) {
      const dir = sort.dir;
      list = [...list].sort((a, b) => {
        switch (sort.key) {
          case "navn":
            return dir * a.name.localeCompare(b.name, "nb");
          case "orgnr":
            // Ubekreftede først når man sorterer på orgnr stigende.
            return dir * ((a.orgNumber ?? "").localeCompare(b.orgNumber ?? "", "nb"));
          case "deals":
            return dir * (a.dealCount - b.dealCount);
          case "eier":
            return dir * a.ownerName.localeCompare(b.ownerName, "nb");
          case "personer":
            return dir * (a.people.length - b.people.length);
          case "lagttil":
            return dir * (a.createdAt - b.createdAt);
          case "sistkontakt":
            return dir * ((a.lastContactAt ?? 0) - (b.lastContactAt ?? 0));
        }
      });
    }
    return list;
  }, [rows, search, tagFilter, sort]);

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const r of visible) next.delete(r.id);
        return next;
      }
      const next = new Set(prev);
      for (const r of visible) next.add(r.id);
      return next;
    });
  }

  const toggleOne = useRangeToggle(setSelected, visible);

  function clearSelection() {
    setSelected(new Set());
    setConfirmingDelete(false);
    setBulkMessage(null);
  }

  function applyOwner() {
    if (!ownerChoice) return;
    const ids = [...selected];
    const ownerId = ownerChoice === "ingen" ? null : Number(ownerChoice);
    startTransition(async () => {
      await bulkSetCompanyOwner(ids, ownerId);
      setBulkMessage(`Satt eier på ${ids.length} selskaper.`);
    });
  }

  function applyBusinessUnit() {
    if (!businessUnitChoice) return;
    const ids = [...selected];
    const businessUnitId = businessUnitChoice === "ingen" ? null : Number(businessUnitChoice);
    startTransition(async () => {
      await bulkSetCompanyBusinessUnit(ids, businessUnitId);
      setBulkMessage(`Satt vårt selskap på ${ids.length} selskaper.`);
    });
  }

  function applyBrregMatch() {
    const ids = [...selected];
    startTransition(async () => {
      const res = await bulkMatchCompaniesBrreg(ids);
      setBulkMessage(`${res.matched} av ${res.checked} ble bekreftet mot Enhetsregisteret.`);
    });
  }

  function applyBulkTags(tagIds: number[]) {
    const ids = [...selected];
    startTransition(async () => {
      for (const tagId of tagIds) await bulkAddCompanyTag(ids, tagId);
      setBulkMessage(`Tagget ${ids.length} selskaper.`);
    });
  }

  function applyDelete() {
    const ids = [...selected];
    startTransition(async () => {
      await bulkDeleteCompanies(ids);
      clearSelection();
    });
  }

  function openMerge() {
    const ids = [...selected];
    setMergeLoading(true);
    setMergeError(null);
    startTransition(async () => {
      const candidates = await getCompaniesForMerge(ids);
      setMergeLoading(false);
      setMergeCandidates(candidates);
    });
  }

  function confirmMerge(keepId: number, mergeIds: number[], overrides: Record<string, number>) {
    setMergeError(null);
    startMergeTransition(async () => {
      const res = await mergeCompanies(keepId, mergeIds, overrides);
      if (res.ok) {
        setMergeCandidates(null);
        clearSelection();
      } else {
        setMergeError(res.message);
      }
    });
  }

  const stats = [
    { label: "Selskaper", value: String(rows.length), icon: <Briefcase size={16} /> },
    { label: "Åpen pipeline", value: formatMoney(totalOpen), icon: <TrendingUp size={16} /> },
    { label: "Vunnet verdi", value: formatMoney(totalWon), icon: <Users size={16} /> },
  ];

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
              {s.icon}
            </div>
            <p className="text-[22px] font-semibold tracking-tight">{s.value}</p>
            <p className="text-[12.5px] text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-[280px]">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Søk i selskap eller person …"
            className="field !rounded-full !py-1.5 !pl-8 text-[12.5px]"
          />
        </div>
        {tags.length > 0 && (
          <TagFilterPicker tags={tags} value={tagFilter} onChange={setTagFilter} />
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-3">
          <span className="text-[13px] font-medium">{selected.size} valgt</span>

          <select
            value={ownerChoice}
            onChange={(e) => setOwnerChoice(e.target.value)}
            className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
          >
            <option value="">Sett eier …</option>
            <option value="ingen">Ingen eier</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            onClick={applyOwner}
            disabled={pending || !ownerChoice}
            className="btn btn-secondary !py-1.5"
          >
            Bruk
          </button>

          <select
            value={businessUnitChoice}
            onChange={(e) => setBusinessUnitChoice(e.target.value)}
            className="field !w-auto !rounded-full !py-1.5 text-[12.5px]"
          >
            <option value="">Sett vårt selskap …</option>
            <option value="ingen">Ikke satt</option>
            {businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={applyBusinessUnit}
            disabled={pending || !businessUnitChoice}
            className="btn btn-secondary !py-1.5"
          >
            Bruk
          </button>

          <button onClick={applyBrregMatch} disabled={pending} className="btn btn-secondary !py-1.5">
            <Wand2 size={13} />
            Match Brreg
          </button>

          <BulkTagPicker tags={tags} disabled={pending} onApply={applyBulkTags} />

          {selected.size >= 2 && (
            <button
              onClick={openMerge}
              disabled={pending || mergeLoading}
              className="btn btn-secondary !py-1.5"
            >
              <GitMerge size={13} />
              {mergeLoading ? "Henter …" : "Slå sammen"}
            </button>
          )}

          {confirmingDelete ? (
            <span className="flex items-center gap-2 rounded-full bg-danger/10 px-3 py-1.5">
              <span className="text-[12.5px] text-danger">Slette {selected.size} selskaper?</span>
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
        <div className="min-w-[1020px]">
        <div
          className={`${GRID} sticky top-0 z-20 rounded-t-[17px] border-b border-line bg-surface/95 px-5 py-2.5 backdrop-blur-xl`}
        >
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAll}
            className="h-3.5 w-3.5"
          />
          <HeaderCell label="Selskap" sortKey="navn" sort={sort} onSort={onSort} />
          <HeaderCell label="Org nr" sortKey="orgnr" sort={sort} onSort={onSort} />
          <HeaderCell label="Deals" sortKey="deals" sort={sort} onSort={onSort} align="center" />
          <span className="flex justify-center">
            <HeaderCell label="Våre kontakter" sortKey="eier" sort={sort} onSort={onSort} align="center" />
          </span>
          <span className="px-2">
            <HeaderCell label="Personer" sortKey="personer" sort={sort} onSort={onSort} />
          </span>
          <span className="px-2">
            <HeaderCell label="Lagt til" sortKey="lagttil" sort={sort} onSort={onSort} />
          </span>
          <span className="px-2">
            <HeaderCell label="Sist kontakt" sortKey="sistkontakt" sort={sort} onSort={onSort} />
          </span>
        </div>

        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-ink-faint">
            Ingen selskaper matcher søket.
          </p>
        ) : (
          <ul>
            {visible.map((c, i) => {
              const companyTags = c.tagIds
                .map((id) => tags.find((t) => t.id === id))
                .filter((t): t is { id: number; label: string } => t != null);
              return (
              <li key={c.id} className="list-row group border-b border-line last:border-b-0">
                <div className={`${GRID} px-5 py-3 transition hover:bg-mist/[0.02]`}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => {}}
                    onClick={(e) => toggleOne(c.id, i, e.shiftKey)}
                    className={`h-3.5 w-3.5 transition-opacity ${
                      selected.has(c.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  />
                  <Link href={`/companies/${c.id}`} className="contents">
                    <span className="flex min-w-0 items-center gap-3">
                      <CompanyLogo logoUrl={c.logoUrl} name={c.name} size={32} radius={9} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-medium">{c.name}</span>
                          {!c.brregVerified && (
                            <TriangleAlert
                              size={12}
                              className="shrink-0 text-warning-ink"
                              aria-label="Ikke bekreftet"
                            />
                          )}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-soft">
                          {c.orgName && c.orgName !== c.name
                            ? c.orgName
                            : c.website
                              ? c.website.replace(/^https?:\/\//, "")
                              : ""}
                        </span>
                        {companyTags.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {companyTags.map((t) => (
                              <span
                                key={t.id}
                                className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                              >
                                {t.label}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-[12.5px] tabular-nums text-ink-soft">
                      {c.orgNumber ? (
                        formatOrgNumber(c.orgNumber)
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </span>
                    <span className="text-center text-[13px] tabular-nums">
                      {c.dealCount}
                      {c.openCount > 0 && c.openCount !== c.dealCount && (
                        <span className="text-ink-faint"> ({c.openCount} åpne)</span>
                      )}
                    </span>
                  </Link>
                  <CompanyOwnerCell
                    companyId={c.id}
                    ownerId={c.ownerId}
                    ownerName={c.ownerName}
                    ownerAvatarUrl={c.ownerAvatarUrl}
                    coOwnerIds={c.coOwnerIds}
                    owners={owners}
                  />
                  <Link
                    href={`/companies/${c.id}`}
                    className="truncate px-2 text-[12.5px] text-ink-soft"
                  >
                    {c.people.length > 0 ? c.people.join(", ") : "—"}
                  </Link>
                  <span className="px-2 text-[12.5px] text-ink-soft">
                    {formatDate(new Date(c.createdAt))}
                  </span>
                  <span className="px-2 text-[12.5px]">
                    {c.lastContactAt ? (
                      <span className={contactToneClass(daysSince(c.lastContactAt))}>
                        {relativeDay(new Date(c.lastContactAt)).label}
                      </span>
                    ) : (
                      <span className="text-danger">Ikke registrert</span>
                    )}
                  </span>
                </div>
              </li>
              );
            })}
          </ul>
        )}
        </div>
      </div>

      {mergeCandidates && (
        <MergeCompaniesDialog
          candidates={mergeCandidates}
          pending={mergePending}
          error={mergeError}
          onConfirm={confirmMerge}
          onCancel={() => setMergeCandidates(null)}
        />
      )}
    </div>
  );
}
