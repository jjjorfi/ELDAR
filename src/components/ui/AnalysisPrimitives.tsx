import clsx from "clsx";
import { ChevronDown, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { useId, useMemo, useState } from "react";

interface SignalHeroProps {
  symbol: string;
  companyName: string;
  eyebrow?: string;
  rating: string;
  scoreLabel: string;
  subcopy: string;
  contextLine?: string;
  trustSignals?: string[];
  tone?: "strongBuy" | "buy" | "hold" | "sell" | "strongSell";
  scoreVisual: JSX.Element;
  meterPercent?: number;
  actions?: JSX.Element;
}

const HERO_TRUST_ICON = [LockKeyhole, ShieldCheck, Zap];

export function SignalHero({
  symbol,
  companyName,
  eyebrow = "Signal",
  rating,
  scoreLabel,
  subcopy,
  contextLine,
  trustSignals = [],
  tone = "hold",
  scoreVisual,
  meterPercent,
  actions
}: SignalHeroProps): JSX.Element {
  const clamped = typeof meterPercent === "number" ? Math.max(0, Math.min(100, meterPercent)) : null;
  const headingId = useId();
  const toneClasses = {
    strongBuy: "border-[#FFBF00]/35 bg-[#FFBF00]/10 text-[#FFBF00]",
    buy: "border-emerald-300/30 bg-emerald-300/10 text-emerald-300",
    hold: "border-white/16 bg-white/[0.04] text-white/82",
    sell: "border-red-300/30 bg-red-300/10 text-red-300",
    strongSell: "border-red-400/35 bg-red-400/12 text-red-200"
  }[tone];

  return (
    <section
      className="eldar-panel texture-card rounded-3xl p-6 md:p-8"
      aria-labelledby={headingId}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/50">{eyebrow}</p>
            {trustSignals.slice(0, 3).map((signal, index) => {
              const Icon = HERO_TRUST_ICON[index] ?? ShieldCheck;
              return (
                <span
                  key={`${signal}-${index}`}
                  className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-white/14 bg-white/[0.03] px-2.5 text-[10px] uppercase tracking-[0.12em] text-white/68"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {signal}
                </span>
              );
            })}
          </div>

          <h2 id={headingId} className="mt-4 text-3xl font-black tracking-[-0.03em] text-white md:text-4xl">
            {symbol}
            <span className="ml-3 align-middle text-lg font-semibold tracking-[-0.02em] text-white/78 md:text-xl">
              {companyName}
            </span>
          </h2>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={clsx("inline-flex min-h-[34px] items-center rounded-full border px-3 text-[11px] font-semibold uppercase tracking-[0.14em]", toneClasses)}>
              {rating}
            </span>
            {contextLine ? (
              <span className="text-sm text-white/62">{contextLine}</span>
            ) : null}
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/76">{subcopy}</p>

          {actions ? <div className="mt-5 flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>

        <div className="rounded-[28px] border border-white/12 bg-black/25 p-4 text-center">
          <div className="mx-auto flex min-h-[168px] items-center justify-center">
            {scoreVisual}
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-white/48">{scoreLabel}</p>
          {clamped !== null ? (
            <div
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.05]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(clamped)}
              aria-label={scoreLabel}
            >
              <div className="h-full bg-white transition-all duration-300 ease-out" style={{ width: `${clamped}%` }} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

interface DriversListProps {
  title?: string;
  items: string[];
  maxCollapsed?: number;
  tone?: "drivers" | "risks";
}

export function DriversList({ title = "Drivers", items, maxCollapsed = 4, tone = "drivers" }: DriversListProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => (expanded ? items : items.slice(0, maxCollapsed)), [expanded, items, maxCollapsed]);
  const canToggle = items.length > maxCollapsed;
  const titleId = useId();

  return (
    <section className="eldar-panel rounded-3xl p-5 texture-card" aria-labelledby={titleId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p id={titleId} className="text-[10px] uppercase tracking-[0.14em] text-white/55">{title}</p>
        {canToggle ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-controls={`${titleId}-list`}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-white/12 px-2.5 text-[9px] uppercase tracking-[0.12em] text-white/68 transition hover:border-white/25 hover:text-white"
          >
            {expanded ? "less" : "more"}
            <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-white/60">No details available.</p>
      ) : (
        <ul id={`${titleId}-list`} className="space-y-2.5 text-sm text-white/80">
          {visible.map((item, index) => (
            <li key={`${tone}-${index}`} className="flex gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
              <span className={clsx("mt-[1px] text-xs", tone === "risks" ? "text-red-300" : "text-emerald-300")}>•</span>
              <span className="leading-6">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface EvidenceSection {
  id: string;
  label: string;
  content: JSX.Element;
}

export function EvidenceAccordions({ sections }: { sections: EvidenceSection[] }): JSX.Element {
  return (
    <section className="evidence-accordion">
      {sections.map((section) => (
        <details key={section.id}>
          <summary>{section.label}</summary>
          <div>{section.content}</div>
        </details>
      ))}
    </section>
  );
}
