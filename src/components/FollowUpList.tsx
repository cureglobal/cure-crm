import Link from "next/link";
import CompanyLogo from "@/components/CompanyLogo";
import Avatar from "@/components/Avatar";
import { relativeDay } from "@/lib/format";
import { stageDot, stageLabel, type Stage } from "@/lib/stages";
import { ArrowRight } from "lucide-react";

export interface FollowUpItem {
  id: number;
  title: string;
  companyName: string;
  logoUrl: string | null;
  stage: string;
  followUpAt: Date;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
}

const MAX_VISIBLE = 7;

export default function FollowUpList({
  heading,
  items,
  seeAllHref,
  emptyText,
  tone = "neutral",
  stages,
}: {
  heading: string;
  items: FollowUpItem[];
  seeAllHref: string;
  emptyText: string;
  tone?: "neutral" | "danger";
  stages: Stage[];
}) {
  const visible = items.slice(0, MAX_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <section className="card flex flex-col p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-semibold tracking-tight">
          {heading}
          {items.length > 0 && (
            <span
              className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[12px] font-medium ${
                tone === "danger" ? "bg-danger/10 text-danger" : "bg-mist/[0.06] text-ink-soft"
              }`}
            >
              {items.length}
            </span>
          )}
        </h2>
        {items.length > 0 && (
          <Link
            href={seeAllHref}
            className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-accent transition hover:gap-1.5"
          >
            Se alle
            <ArrowRight size={12} />
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-faint">{emptyText}</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {visible.map((d) => {
              const rel = relativeDay(d.followUpAt);
              return (
                <li key={d.id}>
                  <Link
                    href={`/leads/${d.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-mist/[0.03]"
                  >
                    <CompanyLogo logoUrl={d.logoUrl} name={d.companyName} size={32} radius={9} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">
                        {d.companyName}
                        <span className="font-normal text-ink-soft"> · {d.title}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: stageDot(stages, d.stage) }}
                        />
                        {stageLabel(stages, d.stage)}
                      </p>
                    </div>
                    {d.ownerName && (
                      <Avatar name={d.ownerName} imageUrl={d.ownerAvatarUrl} size={22} />
                    )}
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                        rel.tone === "overdue"
                          ? "bg-danger/10 text-danger"
                          : rel.tone === "today"
                            ? "bg-warning/15 text-warning-ink"
                            : "bg-mist/[0.05] text-ink-soft"
                      }`}
                    >
                      {rel.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {hidden > 0 && (
            <Link
              href={seeAllHref}
              className="mt-3 border-t border-line pt-3 text-center text-[12.5px] font-medium text-accent transition hover:text-ink"
            >
              +{hidden} flere
            </Link>
          )}
        </>
      )}
    </section>
  );
}
