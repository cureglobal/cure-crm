"use client";

import { useState, useTransition } from "react";
import {
  findDuplicateCompanies,
  getCompaniesForMerge,
  mergeCompanies,
  type DuplicateGroup,
  type MergeCandidate,
} from "@/lib/actions";
import MergeCompaniesDialog from "@/components/MergeCompaniesDialog";
import { Search, GitMerge } from "lucide-react";

const REASON_LABEL: Record<DuplicateGroup["reason"], string> = {
  orgnr: "Samme org.nr",
  domene: "Samme domene",
  navn: "Likt navn",
};

function groupKey(g: DuplicateGroup): string {
  return g.companies
    .map((c) => c.id)
    .sort((a, b) => a - b)
    .join("-");
}

export default function DuplicateCompaniesFinder() {
  const [searching, startSearch] = useTransition();
  const [loadingMerge, startLoadMerge] = useTransition();
  const [merging, startMerge] = useTransition();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[] | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);

  function search() {
    setMergeMessage(null);
    startSearch(async () => {
      setGroups(await findDuplicateCompanies());
    });
  }

  function openMerge(group: DuplicateGroup) {
    const key = groupKey(group);
    setActiveGroupKey(key);
    setMergeError(null);
    startLoadMerge(async () => {
      const candidates = await getCompaniesForMerge(group.companies.map((c) => c.id));
      setMergeCandidates(candidates);
    });
  }

  function confirmMerge(keepId: number, mergeIds: number[], overrides: Record<string, number>) {
    setMergeError(null);
    startMerge(async () => {
      const res = await mergeCompanies(keepId, mergeIds, overrides);
      if (res.ok) {
        setMergeCandidates(null);
        setMergeMessage(res.message);
        setGroups((prev) => prev?.filter((g) => groupKey(g) !== activeGroupKey) ?? prev);
      } else {
        setMergeError(res.message);
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[12.5px] text-ink-soft">
        Finner selskaper som kan være duplikater — likt organisasjonsnummer, likt
        nettside-domene, eller likt navn — så du raskt kan koble sammen dem som faktisk er
        det samme selskapet.
      </p>

      <button onClick={search} disabled={searching} className="btn btn-secondary">
        <Search size={14} className={searching ? "animate-pulse" : ""} />
        {searching ? "Søker …" : "Finn dupliserte selskaper"}
      </button>

      {mergeMessage && (
        <p className="rounded-xl bg-success/10 px-4 py-2.5 text-[13px] font-medium text-success-ink">
          {mergeMessage}
        </p>
      )}

      {groups &&
        (groups.length === 0 ? (
          <p className="text-[12.5px] text-ink-soft">Fant ingen sannsynlige duplikater.</p>
        ) : (
          <div className="w-full rounded-xl border border-line">
            <ul>
              {groups.map((g) => {
                const key = groupKey(g);
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                  >
                    <span className="shrink-0 rounded-full bg-mist/[0.06] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
                      {REASON_LABEL[g.reason]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {g.companies.map((c) => c.name).join(" · ")}
                    </span>
                    <button
                      onClick={() => openMerge(g)}
                      disabled={loadingMerge}
                      className="btn btn-secondary shrink-0 !py-1.5"
                    >
                      <GitMerge size={13} />
                      {loadingMerge && activeGroupKey === key ? "Henter …" : "Slå sammen"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

      {mergeCandidates && (
        <MergeCompaniesDialog
          candidates={mergeCandidates}
          pending={merging}
          error={mergeError}
          onConfirm={confirmMerge}
          onCancel={() => setMergeCandidates(null)}
        />
      )}
    </div>
  );
}
