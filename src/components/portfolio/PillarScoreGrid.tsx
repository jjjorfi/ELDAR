import clsx from "clsx";

import type { PillarResult } from "@/lib/scoring/portfolio-types";

function statusIcon(score: number, flags: string[]): "✓" | "⚠" | "✗" {
  if (flags.length > 0) return "⚠";
  if (score >= 60) return "✓";
  if (score >= 40) return "⚠";
  return "✗";
}

function metricRows(metrics: Record<string, number | string | null>): Array<[string, string]> {
  return Object.entries(metrics)
    .slice(0, 3)
    .map(([key, value]) => [
      key,
      value === null ? "N/A" : typeof value === "number" ? value.toFixed(2) : value
    ]);
}

export function PillarScoreGrid({ pillars }: { pillars: PillarResult[] }): JSX.Element {
  return (
    <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {pillars.map((pillar) => {
        const icon = statusIcon(pillar.score, pillar.flags);
        const delta = pillar.score - pillar.peerMedian;
        const toneClass =
          pillar.score >= 60 ? "text-emerald-300" : pillar.score >= 40 ? "text-amber-300" : "text-red-300";

        return (
          <article key={pillar.key} className="card-grain p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{pillar.label}</p>
                <p className={clsx("mt-1 font-mono text-xl font-bold", toneClass)}>{pillar.score.toFixed(1)}</p>
              </div>
              <span className="text-sm text-white/75">{icon}</span>
            </div>

            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-zinc-200/80" style={{ width: `${Math.max(2, Math.min(100, pillar.score))}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-white/55">
                vs peer median {pillar.peerMedian.toFixed(0)} ({delta >= 0 ? "+" : ""}
                {delta.toFixed(1)})
              </p>
            </div>

            <div className="mt-2 space-y-1 text-[11px] text-white/75">
              {metricRows(pillar.metrics).map(([key, value]) => (
                <div key={`${pillar.key}-${key}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-white/60">{key}</span>
                  <span className="font-mono text-white/85">{value}</span>
                </div>
              ))}
            </div>

            {pillar.flags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {pillar.flags.map((flag) => (
                  <span key={`${pillar.key}-${flag}`} className="rounded-md border border-amber-300/40 bg-amber-200/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                    ⚠ {flag.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
