import clsx from "clsx";

import type { PortfolioRating } from "@/lib/scoring/portfolio-types";

function toPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-6);

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function RiskCharts({ rating }: { rating: PortfolioRating }): JSX.Element {
  const width = 280;
  const height = 120;
  const portfolioPath = toPath(rating.riskSeries.portfolio, width, height);
  const benchmarkPath = toPath(rating.riskSeries.benchmark, width, height);
  const maxSharpeAbs = Math.max(
    1,
    ...rating.riskSeries.rollingSharpe.map((value) => Math.abs(value))
  );
  const oneYearReturn = rating.pillars.find((pillar) => pillar.key === "return")?.metrics?.oneYearReturn;
  const maxDrawdown = rating.pillars.find((pillar) => pillar.key === "drawdown")?.metrics?.maxDrawdown;

  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <article className="eldar-panel rounded-2xl p-4">
        <h3 className="text-[10px] uppercase tracking-[0.12em] text-white/55">Cumulative Return vs Benchmark</h3>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/15 bg-black/20 p-2">
          {portfolioPath && benchmarkPath ? (
            <svg viewBox={`0 0 ${width} ${height}`} className="h-[140px] w-full" aria-hidden="true">
              <path d={benchmarkPath} fill="none" stroke="rgba(148,163,184,0.75)" strokeWidth="1.5" />
              <path d={portfolioPath} fill="none" stroke="#FFBF00" strokeWidth="1.9" />
            </svg>
          ) : (
            <div className="flex h-[140px] items-center justify-center text-xs text-white/55">Not enough history for curve</div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {typeof oneYearReturn === "string" ? <span className="text-[#22C55E]">{oneYearReturn} 1Y Return</span> : null}
          {typeof oneYearReturn === "string" && typeof maxDrawdown === "string" ? <span className="text-[#555]">·</span> : null}
          {typeof maxDrawdown === "string" ? <span className="text-[#EF4444]">{maxDrawdown} Max DD</span> : null}
        </div>
      </article>

      <article className="eldar-panel rounded-2xl p-4">
        <h3 className="text-[10px] uppercase tracking-[0.12em] text-white/55">Rolling 12m Sharpe</h3>
        <div className="mt-3 flex h-[140px] items-end gap-1 overflow-hidden rounded-lg border border-white/15 bg-black/20 p-2">
          {rating.riskSeries.rollingSharpe.length > 0 ? (
            rating.riskSeries.rollingSharpe.map((value, index) => {
              const scaled = Math.max(0, (Math.abs(value) / maxSharpeAbs) * 100);
              const toneClass =
                value > 1 ? "bg-emerald-300/80" : value >= 0 ? "bg-amber-300/80" : "bg-red-300/80";
              return (
                <div
                  key={`sharpe-${index}`}
                  className={clsx("min-w-[5px] flex-1", toneClass)}
                  style={{ height: `${Math.max(4, scaled)}%` }}
                  title={`Sharpe ${value.toFixed(2)}`}
                />
              );
            })
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-white/55">Not enough history for rolling Sharpe</div>
          )}
        </div>
      </article>
    </section>
  );
}
