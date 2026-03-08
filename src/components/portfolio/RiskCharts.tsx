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
  const height = 96;
  const portfolioPath = toPath(rating.riskSeries.portfolio, width, height);
  const benchmarkPath = toPath(rating.riskSeries.benchmark, width, height);
  const maxSharpeAbs = Math.max(
    1,
    ...rating.riskSeries.rollingSharpe.map((value) => Math.abs(value))
  );
  return (
    <section className="grid gap-2 lg:grid-cols-2">
      <article className="card-grain p-2">
        <h3 className="text-[10px] uppercase tracking-[0.12em] text-white/55">Cumulative Return vs Benchmark</h3>
        <div className="mt-2 overflow-hidden p-2">
          {portfolioPath && benchmarkPath ? (
            <svg viewBox={`0 0 ${width} ${height}`} className="h-[108px] w-full" aria-hidden="true">
              <path d={benchmarkPath} fill="none" stroke="rgba(148,163,184,0.75)" strokeWidth="1.5" />
              <path d={portfolioPath} fill="none" stroke="#FFBF00" strokeWidth="1.9" />
            </svg>
          ) : (
            <div className="flex h-[108px] items-center justify-center text-xs text-white/55">Not enough history for curve</div>
          )}
        </div>
      </article>

      <article className="card-grain p-2">
        <h3 className="text-[10px] uppercase tracking-[0.12em] text-white/55">Rolling 12m Sharpe</h3>
        <div className="mt-2 flex h-[108px] items-end gap-1 overflow-hidden p-2">
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
                  aria-label={`Sharpe ${value.toFixed(2)}`}
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
