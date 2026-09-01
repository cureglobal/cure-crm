"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { globalSearch } from "@/lib/actions";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import { Search } from "lucide-react";

interface DealHit {
  id: number;
  title: string;
  companyName: string;
  logoUrl: string | null;
  slug: string;
}
interface PersonHit {
  id: number;
  name: string;
  email: string | null;
}
interface CompanyHit {
  id: number;
  name: string;
  orgName: string | null;
  logoUrl: string | null;
}
interface Results {
  deals: DealHit[];
  people: PersonHit[];
  companies: CompanyHit[];
}

const EMPTY: Results = { deals: [], people: [], companies: [] };

// Flat, navigasjonsrekkefølge for piltaster/Enter — samme rekkefølge som
// gruppene vises i (Deals, Selskap, Personer).
function flattenResults(results: Results): { href: string }[] {
  return [
    ...results.deals.map((d) => ({ href: `/leads/${d.slug}` })),
    ...results.companies.map((c) => ({ href: `/companies/${c.id}` })),
    ...results.people.map((p) => ({ href: `/people/${p.id}` })),
  ];
}

function ResultRow({
  href,
  onNavigate,
  icon,
  title,
  subtitle,
  selected,
  rowRef,
}: {
  href: string;
  onNavigate: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  selected: boolean;
  rowRef?: (el: HTMLAnchorElement | null) => void;
}) {
  return (
    <Link
      ref={rowRef}
      href={href}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${
        selected ? "bg-accent-soft text-accent" : "hover:bg-mist/[0.05]"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{title}</span>
        {subtitle && (
          <span className="block truncate text-[11px] text-ink-faint">{subtitle}</span>
        )}
      </span>
    </Link>
  );
}

function ResultsList({
  results,
  pending,
  hasQuery,
  onNavigate,
  selectedIndex,
  selectedRowRef,
}: {
  results: Results;
  pending: boolean;
  hasQuery: boolean;
  onNavigate: () => void;
  selectedIndex: number;
  selectedRowRef: (el: HTMLAnchorElement | null) => void;
}) {
  if (!hasQuery) {
    return <p className="px-2 py-3 text-[12px] text-ink-faint">Skriv minst 2 tegn for å søke.</p>;
  }
  const total = results.deals.length + results.people.length + results.companies.length;
  if (total === 0) {
    return (
      <p className="px-2 py-3 text-[12px] text-ink-faint">
        {pending ? "Søker …" : "Ingen treff."}
      </p>
    );
  }
  const companiesOffset = results.deals.length;
  const peopleOffset = companiesOffset + results.companies.length;
  return (
    <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
      {results.deals.length > 0 && (
        <div>
          <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
            Deals
          </p>
          {results.deals.map((d, i) => (
            <ResultRow
              key={d.id}
              href={`/leads/${d.slug}`}
              onNavigate={onNavigate}
              icon={<CompanyLogo logoUrl={d.logoUrl} name={d.companyName} size={24} radius={7} />}
              title={d.title}
              subtitle={d.companyName}
              selected={selectedIndex === i}
              rowRef={selectedIndex === i ? selectedRowRef : undefined}
            />
          ))}
        </div>
      )}
      {results.companies.length > 0 && (
        <div>
          <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
            Selskap
          </p>
          {results.companies.map((c, i) => (
            <ResultRow
              key={c.id}
              href={`/companies/${c.id}`}
              onNavigate={onNavigate}
              icon={<CompanyLogo logoUrl={c.logoUrl} name={c.name} size={24} radius={7} />}
              title={c.name}
              subtitle={c.orgName && c.orgName !== c.name ? c.orgName : null}
              selected={selectedIndex === companiesOffset + i}
              rowRef={selectedIndex === companiesOffset + i ? selectedRowRef : undefined}
            />
          ))}
        </div>
      )}
      {results.people.length > 0 && (
        <div>
          <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
            Personer
          </p>
          {results.people.map((p, i) => (
            <ResultRow
              key={p.id}
              href={`/people/${p.id}`}
              onNavigate={onNavigate}
              icon={<Avatar name={p.name} size={24} />}
              title={p.name}
              subtitle={p.email}
              selected={selectedIndex === peopleOffset + i}
              rowRef={selectedIndex === peopleOffset + i ? selectedRowRef : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function GlobalSearch({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRowRef = useRef<HTMLAnchorElement | null>(null);

  const flatItems = useMemo(() => flattenResults(results), [results]);

  // Samme debounce-mønster (300ms, min. 2 tegn) som Brreg-søket i BrregMatchAll/NewDealButton.
  /* eslint-disable react-hooks/set-state-in-effect -- rydder søketreff momentant når input blir for kort */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        setResults(await globalSearch(q));
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Ny treffliste → start alltid på første rad, slik at Enter umiddelbart
  // åpner toppresultatet slik man er vant til fra andre søk (Spotlight o.l.).
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function openSearch() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function close() {
    setOpen(false);
    setQuery("");
    setResults(EMPTY);
  }

  // Cmd/Ctrl+F åpner søket fra hvor som helst i appen, i stedet for
  // nettleserens innebygde "finn på siden" — samme idiom som Spotlight-søk i
  // andre apper (Linear, Notion o.l.).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) {
        router.push(item.href);
        close();
      }
    }
  }

  const hasQuery = query.trim().length >= 2;

  if (collapsed) {
    return (
      <div className="relative px-3">
        <button
          onClick={openSearch}
          title="Søk (⌘F)"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-mist/[0.04] hover:text-ink"
        >
          <Search size={17} strokeWidth={1.8} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div className="absolute left-full top-0 z-50 ml-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-pop">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Søk i deals, personer, selskap …"
                className="field mb-2 !py-1.5 text-[12.5px]"
              />
              <ResultsList
                results={results}
                pending={pending}
                hasQuery={hasQuery}
                onNavigate={close}
                selectedIndex={selectedIndex}
                selectedRowRef={(el) => {
                  selectedRowRef.current = el;
                }}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative px-3 pb-3">
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Søk … (⌘F)"
          className="field !py-1.5 !pl-8 text-[13px]"
        />
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-xl border border-line bg-surface p-2 shadow-pop">
            <ResultsList
              results={results}
              pending={pending}
              hasQuery={hasQuery}
              onNavigate={close}
              selectedIndex={selectedIndex}
              selectedRowRef={(el) => {
                selectedRowRef.current = el;
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
