"use client";

import { useMemo, useState } from "react";

import type { PortfolioRating } from "@/lib/scoring/portfolio-types";

const PILLAR_ORDER = [
  { key: "return", label: "RETURN" },
  { key: "risk", label: "RISK" },
  { key: "drawdown", label: "DRAWDOWN" },
  { key: "diversification", label: "DIVERSIF." },
  { key: "implementability", label: "IMPL." },
  { key: "eldarTilt", label: "TILT" }
] as const;

const PILLAR_NOTES: Record<string, string> = {
  return: "Higher score means stronger peer-relative portfolio returns.",
  risk: "Higher score means better risk-adjusted profile vs peers.",
  drawdown: "Higher score means shallower drawdowns and better downside control.",
  diversification: "Higher score means concentration risk is lower.",
  implementability: "Higher score means easier execution and lower friction cost.",
  eldarTilt: "Higher score means portfolio is tilted toward higher ELDAR signals."
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function pointAt(index: number, value: number, radius: number): { x: number; y: number } {
  const angleDeg = index * 60;
  const angle = (angleDeg * Math.PI) / 180;
  const scaled = (clampScore(value) / 100) * radius;
  return {
    x: Math.sin(angle) * scaled,
    y: -Math.cos(angle) * scaled
  };
}

function polygonPoints(values: number[], radius: number): string {
  return values
    .map((value, index) => {
      const point = pointAt(index, value, radius);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");
}

interface PortfolioRatingHeaderProps {
  rating: PortfolioRating;
}

export function PortfolioRatingHeader({ rating }: PortfolioRatingHeaderProps): JSX.Element {
  const radius = 96;
  const rings = [20, 40, 60, 80, 100];
  const [hoveredPillarKey, setHoveredPillarKey] = useState<string>("return");

  const availablePillars = rating.pillars.filter((pillar) => pillar.hasData);
  const totalWeight = availablePillars.reduce((sum, pillar) => sum + pillar.weight, 0);
  const contributionRows = availablePillars
    .map((pillar) => ({
      key: pillar.key,
      label: pillar.label,
      contribution: totalWeight > 0 ? ((pillar.score / 100) * pillar.weight * 10) / totalWeight : 0
    }))
    .sort((left, right) => right.contribution - left.contribution);

  const portfolioValues = PILLAR_ORDER.map((item) => rating.pillars.find((pillar) => pillar.key === item.key)?.score ?? 0);
  const peerValues = PILLAR_ORDER.map((item) => rating.pillars.find((pillar) => pillar.key === item.key)?.peerMedian ?? 50);

  const activePillar = useMemo(() => {
    const fallback = rating.pillars[0] ?? null;
    return rating.pillars.find((pillar) => pillar.key === hoveredPillarKey) ?? fallback;
  }, [hoveredPillarKey, rating.pillars]);

  return (
    <section className="p-0">
      <div className="grid gap-6 xl:grid-cols-[minmax(340px,1.05fr)_minmax(420px,1.45fr)] xl:items-stretch">
        <div className="p-1.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Composite Score Breakdown</p>
          <div className="mt-3 space-y-2">
            {contributionRows.map((row) => (
              <div key={`contrib-${row.key}`}>
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="text-white/70">{row.label}</span>
                  <span className="font-mono text-white">{row.contribution.toFixed(2)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="glow-tip h-full bg-zinc-200/80" style={{ width: `${Math.max(4, Math.min(100, row.contribution * 50))}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-white/58">Coverage: {(rating.dataCompleteness * 100).toFixed(0)}%</p>
        </div>

        <div className="p-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/60">Portfolio Radar · 6 Pillars</p>
          </div>
          <svg viewBox="-140 -140 280 280" className="mx-auto mt-2 w-full max-w-[430px]">
            <defs>
              <radialGradient id="eldarRadarFill" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FFBF00" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#FFBF00" stopOpacity="0.05" />
              </radialGradient>
              <radialGradient id="eldarRadarPeerFill" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#5B8DD9" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#5B8DD9" stopOpacity="0.03" />
              </radialGradient>
            </defs>

            {rings.map((ring) => (
              <polygon
                key={`ring-${ring}`}
                points={polygonPoints([ring, ring, ring, ring, ring, ring], radius)}
                fill="none"
                stroke={ring === 100 ? "#2A2A2A" : "#1A1A1A"}
                strokeWidth={ring === 100 ? 1.4 : 1}
              />
            ))}

            {PILLAR_ORDER.map((item, index) => {
              const outer = pointAt(index, 100, radius);
              const active = activePillar?.key === item.key;
              return (
                <line
                  key={`axis-${item.key}`}
                  x1="0"
                  y1="0"
                  x2={outer.x}
                  y2={outer.y}
                  stroke={active ? "#3a3a3a" : "#1E1E1E"}
                  strokeWidth={active ? 1.4 : 1}
                />
              );
            })}

            <polygon
              points={polygonPoints(peerValues, radius)}
              fill="url(#eldarRadarPeerFill)"
              stroke="#5B8DD9"
              strokeDasharray="4 3"
              strokeWidth="1"
              opacity="0.65"
            />

            <polygon
              points={polygonPoints(portfolioValues, radius)}
              fill="url(#eldarRadarFill)"
              stroke="#FFBF00"
              strokeWidth="2"
              strokeLinejoin="round"
            />

            {PILLAR_ORDER.map((item, index) => {
              const pillar = rating.pillars.find((candidate) => candidate.key === item.key);
              const value = pillar?.score ?? 0;
              const dot = pointAt(index, value, radius);
              const labelPoint = pointAt(index, 114, radius);
              const active = activePillar?.key === item.key;

              return (
                <g key={`pillar-${item.key}`}>
                  <circle
                    cx={dot.x}
                    cy={dot.y}
                    r={active ? 4.2 : 3.1}
                    fill="#FFBF00"
                    onMouseEnter={() => setHoveredPillarKey(item.key)}
                  />
                  <circle
                    cx={dot.x}
                    cy={dot.y}
                    r="12"
                    fill="transparent"
                    onMouseEnter={() => setHoveredPillarKey(item.key)}
                  />
                  <text
                    x={labelPoint.x}
                    y={labelPoint.y}
                    textAnchor="middle"
                    fontFamily="Neue Haas Grotesk Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    fontSize="8"
                    letterSpacing="1"
                    fill={active ? "#9d9d9d" : "#666"}
                    onMouseEnter={() => setHoveredPillarKey(item.key)}
                  >
                    {item.label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="mt-2 p-1.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/60">
              {activePillar?.label ?? "Pillar"} · {Math.round(activePillar?.score ?? 0)} / 100
            </p>
            <p className="mt-1 text-xs text-white/72">
              Peer median {Math.round(activePillar?.peerMedian ?? 50)} · {PILLAR_NOTES[activePillar?.key ?? "return"]}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
