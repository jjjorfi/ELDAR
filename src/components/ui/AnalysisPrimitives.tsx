import clsx from "clsx";
import { useMemo, useState } from "react";

interface SignalHeroProps {
  heading: string;
  rating: string;
  score: string;
  confidence?: string;
  updatedAt?: string;
  meterPercent?: number;
  action?: JSX.Element;
}

export function SignalHero({ heading, rating, score, confidence, updatedAt, meterPercent, action }: SignalHeroProps): JSX.Element {
  const clamped = typeof meterPercent === "number" ? Math.max(0, Math.min(100, meterPercent)) : null;
  return (
    <section className="eldar-panel texture-card rounded-3xl p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/55">Signal</p>
          <h2 className="mt-2 text-2xl font-black text-white md:text-3xl">{heading}</h2>
          <p className="mt-2 text-sm text-white/70">{rating}</p>
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="inked-number text-3xl font-black text-white md:text-4xl">{score}</p>
        {confidence ? <span className="border border-white/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white/65">{confidence}</span> : null}
        {updatedAt ? <span className="text-[10px] uppercase tracking-[0.12em] text-white/45">{updatedAt}</span> : null}
      </div>
      {clamped !== null ? (
        <div className="mt-4 h-1.5 w-full overflow-hidden border border-white/10 bg-black/25">
          <div className="h-full bg-[#FFBF00] transition-all duration-300 ease-out" style={{ width: `${clamped}%` }} />
        </div>
      ) : null}
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

  return (
    <section className="eldar-panel rounded-3xl p-5 texture-card">
      <p className="mb-3 text-[10px] uppercase tracking-[0.14em] text-white/55">{title}</p>
      {visible.length === 0 ? (
        <p className="text-sm text-white/60">No details available.</p>
      ) : (
        <ul className="space-y-2 text-sm text-white/80">
          {visible.map((item, index) => (
            <li key={`${tone}-${index}`} className="flex gap-2">
              <span className={clsx("mt-[1px] text-xs", tone === "risks" ? "text-red-300" : "text-emerald-300")}>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
      {canToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-3 text-[9px] uppercase tracking-[0.12em] text-[#FFBF00]"
        >
          {expanded ? "less" : "more"}
        </button>
      ) : null}
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
