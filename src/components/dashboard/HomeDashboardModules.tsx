// AI CONTEXT TRACE
// Extracted home dashboard display modules from StockDashboard. These are
// presentational-only and intentionally keep the same visuals/behavior while
// shrinking the main dashboard component. Any data/state changes should stay in
// StockDashboard and flow in via props.

"use client";

import clsx from "clsx";
import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LinesSkeleton } from "@/components/ui/FintechPrimitives";
import { usePopupWheelScroll } from "@/hooks/usePopupWheelScroll";
import type {
  HomeMarketMoverItem,
  HomeNewsItem,
  HomeDashboardPayload,
  HomeRegimeMetric,
  HomeSectorRotationItem,
  HomeSnapshotItem,
  SectorRotationWindow
} from "@/lib/home/dashboard-types";
import { formatPrice } from "@/lib/utils";

const SECTOR_ROTATION_WINDOW_OPTIONS: SectorRotationWindow[] = ["YTD", "1M", "3M", "6M"];

function formatSignedPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

function dashboardValueToneClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-white/45";
  if (value > 0) return "text-emerald-300";
  if (value < 0) return "text-red-300";
  return "text-white/70";
}

function dashboardToneClass(tone: HomeRegimeMetric["tone"]): string {
  if (tone === "positive") return "text-emerald-300";
  if (tone === "negative") return "text-red-300";
  return "text-white/58";
}

function macroRegimeToneClasses(label: HomeDashboardPayload["regime"]["label"]): {
  badge: string;
  needle: string;
} {
  if (label === "MAXIMUM_EXPANSION") {
    return {
      badge: "border-[#FFBF00]/35 bg-[#FFBF00]/10 text-[#FFBF00] shadow-[0_0_18px_rgba(255,191,0,0.18)]",
      needle: "#FFBF00"
    };
  }
  if (label === "CONSTRUCTIVE_BIAS") {
    return {
      badge: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.18)]",
      needle: "#6EE7B7"
    };
  }
  if (label === "CHOP_DISTRIBUTION") {
    return {
      badge: "border-white/14 bg-white/[0.06] text-white/78 shadow-[0_0_18px_rgba(255,255,255,0.12)]",
      needle: "#F5F5F5"
    };
  }
  if (label === "DEFENSIVE_LIQUIDATION") {
    return {
      badge: "border-[#FF8A5B]/35 bg-[#FF8A5B]/10 text-[#FF8A5B] shadow-[0_0_18px_rgba(255,138,91,0.16)]",
      needle: "#FF8A5B"
    };
  }
  return {
    badge: "border-red-400/35 bg-red-400/10 text-red-300 shadow-[0_0_18px_rgba(248,113,113,0.16)]",
    needle: "#F87171"
  };
}

function formatMacroRegimeLabel(label: HomeDashboardPayload["regime"]["label"]): string {
  return label.replace(/_/g, " ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const radians = (Math.PI / 180) * angleDeg;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy - radius * Math.sin(radians)
  };
}

function arcPath(cx: number, cy: number, radius: number, startAngleDeg: number, endAngleDeg: number): string {
  const start = polarToCartesian(cx, cy, radius, startAngleDeg);
  const end = polarToCartesian(cx, cy, radius, endAngleDeg);
  const largeArcFlag = Math.abs(endAngleDeg - startAngleDeg) > 180 ? 1 : 0;
  const sweepFlag = endAngleDeg < startAngleDeg ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

function formatSnapshotDisplayValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const absValue = Math.abs(value);
  if (absValue >= 1000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  if (absValue >= 100) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  return value.toFixed(2);
}

function snapSectorAxisMagnitude(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.max(5, Math.ceil(value / 5) * 5);
}

function formatSectorAxisLabel(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0%";
  const snapped = Math.round(value / 5) * 5;
  return `${snapped > 0 ? "+" : "−"}${Math.abs(snapped)}%`;
}

function signalStrengthClass(strength: HomeSectorRotationItem["signalStrength"]): string {
  if (strength === "STRONG") return "text-[#FFBF00]";
  if (strength === "CONSTRUCTIVE") return "text-emerald-300";
  if (strength === "WEAK") return "text-red-300";
  return "text-white/55";
}

function macroIndicatorRead(score: number): string {
  if (score > 0.3) return "supportive";
  if (score < -0.3) return "stressed";
  return "mixed";
}

function macroPillarRead(contribution: number): string {
  if (contribution > 1.2) return "supportive";
  if (contribution < -1.2) return "stressed";
  return "balanced";
}

const REGIME_GAUGE_ZONES = [
  { key: "systemic", label: "Systemic Shock", min: -10, max: -7.5, color: "rgba(248,113,113,0.88)" },
  { key: "defensive", label: "Defensive Liquidation", min: -7.5, max: -2.5, color: "rgba(255,138,91,0.82)" },
  { key: "chop", label: "Chop Distribution", min: -2.5, max: 2.5, color: "rgba(255,255,255,0.34)" },
  { key: "constructive", label: "Constructive Bias", min: 2.5, max: 7.5, color: "rgba(110,231,183,0.82)" },
  { key: "expansion", label: "Maximum Expansion", min: 7.5, max: 10, color: "rgba(255,191,0,0.92)" }
] as const;

function scoreToGaugeAngle(score: number): number {
  return 180 - ((score + 10) / 20) * 180;
}

function formatGaugeRange(min: number, max: number): string {
  const left = `${min > 0 ? "+" : ""}${min.toFixed(1)}`;
  const right = `${max > 0 ? "+" : ""}${max.toFixed(1)}`;
  return `${left} to ${right}`;
}

export function DashboardMetricTile({ metric }: { metric: HomeRegimeMetric }): JSX.Element {
  return (
    <div className="eldar-dashboard-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/42">{metric.label}</p>
      <p className="mt-3 text-[24px] font-semibold tracking-[-0.03em] text-white">{metric.displayValue}</p>
      <p className={clsx("mt-2 text-[11px] font-medium", dashboardToneClass(metric.tone))}>
        {metric.detail}
      </p>
    </div>
  );
}

export function MacroEnvironmentCard({
  regime,
  loading
}: {
  regime: HomeDashboardPayload["regime"] | null;
  loading: boolean;
}): JSX.Element {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hoveredZoneKey, setHoveredZoneKey] = useState<string | null>(null);
  const handleDrawerWheel = usePopupWheelScroll<HTMLElement>();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  if (loading && !regime) {
    return (
      <section className="eldar-panel texture-none xl:col-span-8 p-6">
        <div className="mb-5">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Macro Environment</p>
        </div>
        <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="min-h-[244px]" />
          <LinesSkeleton rows={5} />
        </div>
      </section>
    );
  }

  const activeRegime = regime;
  if (!activeRegime) {
    return (
      <section className="eldar-panel texture-none xl:col-span-8 p-6">
        <div className="flex min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-white/10 text-center text-sm text-white/46">
          Macro regime data is unavailable.
        </div>
      </section>
    );
  }

  const score = Math.max(-10, Math.min(10, activeRegime.compositeScore));
  const tone = macroRegimeToneClasses(activeRegime.label);
  const angle = scoreToGaugeAngle(score);
  const needleTip = polarToCartesian(110, 110, 70, angle);
  const tickAngles = [180, 157.5, 112.5, 90, 67.5, 22.5, 0];
  const hoveredZone = hoveredZoneKey ? REGIME_GAUGE_ZONES.find((zone) => zone.key === hoveredZoneKey) ?? null : null;
  const simplifiedPillars = [
    { key: "plumbing", label: "Plumbing", detail: "Rates and credit stress", result: activeRegime.pillars.plumbing },
    { key: "cycle", label: "Cycle", detail: "Growth and recession structure", result: activeRegime.pillars.cycle },
    { key: "sentiment", label: "Sentiment", detail: "Coincident market pressure", result: activeRegime.pillars.sentiment },
    { key: "defense", label: "Defense", detail: "Industrial vs fear bid", result: activeRegime.pillars.defense }
  ] as const;

  return (
      <section className="eldar-panel texture-none xl:col-span-8 p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Macro Environment</p>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open macro breakdown"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.03] text-white/72 transition hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
      </div>

      <div className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex min-h-[244px] flex-col items-center justify-center px-2 py-2">
          <div className="flex w-full max-w-[260px] flex-col items-center">
            <svg viewBox="0 0 220 140" className="h-[156px] w-full max-w-[220px]" aria-label="Macro regime gauge" role="img">
              <path d={arcPath(110, 110, 82, 180, 0)} stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <path d={arcPath(110, 110, 76, 180, 0)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" strokeLinecap="round" />
              {REGIME_GAUGE_ZONES.map((zone) => {
                const isHovered = hoveredZoneKey === zone.key;
                const isActive = activeRegime.label === zone.label.replace(/ /g, "_").toUpperCase();
                return (
                  <g key={zone.key}>
                    <path
                      d={arcPath(110, 110, 82, scoreToGaugeAngle(zone.min), scoreToGaugeAngle(zone.max))}
                      stroke={zone.color}
                      strokeWidth={isHovered ? 7 : isActive ? 6 : 5}
                      fill="none"
                      strokeLinecap="round"
                      opacity={isHovered ? 1 : isActive ? 0.92 : 0.38}
                      className="transition-all duration-150 ease-out"
                    />
                    <path
                      d={arcPath(110, 110, 82, scoreToGaugeAngle(zone.min), scoreToGaugeAngle(zone.max))}
                      stroke="transparent"
                      strokeWidth="18"
                      fill="none"
                      strokeLinecap="round"
                      tabIndex={0}
                      aria-label={`${zone.label}, ${formatGaugeRange(zone.min, zone.max)}`}
                      onMouseEnter={() => setHoveredZoneKey(zone.key)}
                      onMouseLeave={() => setHoveredZoneKey(null)}
                      onFocus={() => setHoveredZoneKey(zone.key)}
                      onBlur={() => setHoveredZoneKey(null)}
                    />
                  </g>
                );
              })}
              {tickAngles.map((tickAngle) => {
              const outer = polarToCartesian(110, 110, 92, tickAngle);
              const inner = polarToCartesian(110, 110, tickAngle === 180 || tickAngle === 0 || tickAngle === 90 ? 74 : 78, tickAngle);
              return (
                <line
                  key={`macro-tick-${tickAngle}`}
                  x1={outer.x}
                  y1={outer.y}
                  x2={inner.x}
                  y2={inner.y}
                  stroke="rgba(255,255,255,0.24)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              );
            })}
            <line
              x1="110"
              y1="110"
              x2={needleTip.x}
              y2={needleTip.y}
              stroke={tone.needle}
              strokeWidth="2.4"
              strokeLinecap="round"
              className="transition-all duration-300 ease-out"
            />
              <circle cx="110" cy="110" r="8" fill="#050505" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
              <circle cx="110" cy="110" r="2.5" fill={tone.needle} />
            </svg>
            <div className="mt-2 h-[34px] text-center">
              {hoveredZone ? (
                <>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/68">{hoveredZone.label}</p>
                  <p className="mt-1 font-mono text-[10px] text-white/42">{formatGaugeRange(hoveredZone.min, hoveredZone.max)}</p>
                </>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: tone.needle }}>{formatMacroRegimeLabel(activeRegime.label)}</p>
                  <p className="mt-1 font-mono text-[10px] text-white/42">{score > 0 ? "+" : ""}{score.toFixed(1)} current read</p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-[244px] flex-col justify-between">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {activeRegime.gatesFired.length > 0 ? (
                <span className="rounded-full border border-red-300/24 bg-red-300/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-red-200/85">
                  {activeRegime.gatesFired.length} gate{activeRegime.gatesFired.length > 1 ? "s" : ""} active
                </span>
              ) : null}
              {activeRegime.warnings.length > 0 ? (
                <span className="text-sm text-red-200/82">{activeRegime.warnings[0]}</span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {activeRegime.metrics.map((metric) => (
              <DashboardMetricTile key={metric.key} metric={metric} />
            ))}
          </div>
        </div>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-[120] flex">
          <button
            type="button"
            aria-label="Close macro regime drawer"
            className="flex-1 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <aside onWheelCapture={handleDrawerWheel} className="eldar-scrollbar h-full w-full max-w-[540px] overflow-y-auto overscroll-contain border-l border-white/10 bg-[#0B0B0B] px-5 py-5 shadow-[0_0_60px_rgba(0,0,0,0.55)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/42">Macro Read</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">{formatMacroRegimeLabel(activeRegime.label)}</h3>
                <p className="mt-2 text-sm leading-6 text-white/62">Four pillars. One regime. Only the current pressure points.</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-full border border-white/12 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-white/68 transition hover:border-white/25 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              {activeRegime.warnings.length > 0 ? (
                <div className="rounded-[22px] border border-red-300/16 bg-red-300/8 p-4">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-red-200/70">Active pressure</p>
                  <div className="mt-3 space-y-2">
                    {activeRegime.warnings.map((warning, index) => (
                      <p key={`macro-warning-${index}`} className="text-sm leading-6 text-red-100/88">
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                {simplifiedPillars.map((pillar) => (
                  <div key={pillar.key} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-white/42">{pillar.label}</p>
                        <p className="mt-1 text-sm text-white/78">{macroPillarRead(pillar.result.contribution)}</p>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-white/36">{pillar.detail}</span>
                    </div>
                    <div className="mt-4 space-y-2.5">
                      {pillar.result.indicators.map((indicator) => (
                        <div key={`${pillar.key}-${indicator.name}`} className="flex items-center justify-between gap-3">
                          <span className="text-sm text-white/78">{indicator.name}</span>
                          <span
                            className={clsx(
                              "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
                              indicator.finalScore > 0.3 && "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
                              indicator.finalScore < -0.3 && "border-red-300/20 bg-red-300/10 text-red-200",
                              indicator.finalScore >= -0.3 && indicator.finalScore <= 0.3 && "border-white/12 bg-white/[0.04] text-white/58"
                            )}
                          >
                            {macroIndicatorRead(indicator.finalScore)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

export function SnapshotTile({ item }: { item: HomeSnapshotItem }): JSX.Element {
  return (
    <div className="eldar-dashboard-surface min-h-[124px] px-4 py-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/42">{item.label}</p>
      <p className="mt-5 font-mono text-[22px] font-semibold tracking-[-0.03em] text-white">
        {formatSnapshotDisplayValue(item.price)}
      </p>
      <div className="mt-5 flex items-center justify-between">
        <span className={clsx("text-[11px] font-medium", dashboardValueToneClass(item.changePercent))}>
          {item.changePercent === null ? "Flat feed" : formatSignedPercent(item.changePercent, 2)}
        </span>
        <span
          className={clsx(
            "h-2.5 w-2.5 rounded-full",
            item.changePercent === null && "bg-white/25",
            typeof item.changePercent === "number" && item.changePercent > 0 && "bg-emerald-300",
            typeof item.changePercent === "number" && item.changePercent < 0 && "bg-red-300"
          )}
        />
      </div>
    </div>
  );
}

interface SectorRotationBoardProps {
  rows: HomeSectorRotationItem[];
  currentWindow: SectorRotationWindow;
  onWindowChange: (window: SectorRotationWindow) => void;
}

export function SectorRotationBoard({ rows, currentWindow, onWindowChange }: SectorRotationBoardProps): JSX.Element {
  const [hoveredEtf, setHoveredEtf] = useState<string | null>(rows[0]?.etf ?? null);

  useEffect(() => {
    setHoveredEtf((current) => {
      if (current && rows.some((row) => row.etf === current)) return current;
      return rows[0]?.etf ?? null;
    });
  }, [rows]);

  const activeRow = rows.find((row) => row.etf === hoveredEtf) ?? rows[0] ?? null;
  const axisAbsMax = snapSectorAxisMagnitude(
    Math.max(
      5,
      ...rows
        .map((row) => row.performancePercent)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map((value) => Math.abs(value))
    )
  );

  return (
    <section className="eldar-panel texture-none xl:col-span-8 p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Sector Rotation</p>
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {SECTOR_ROTATION_WINDOW_OPTIONS.map((windowOption) => (
            <button
              key={`sector-window-${windowOption}`}
              type="button"
              onClick={() => onWindowChange(windowOption)}
              aria-pressed={currentWindow === windowOption}
              className={clsx(
                "eldar-dashboard-pill rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.14em]",
                currentWindow === windowOption && "bg-white text-black hover:bg-white"
              )}
            >
              {windowOption}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-white/10 text-sm text-white/48">
          Sector rotation data is unavailable.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
          <div className="eldar-dashboard-surface flex min-h-[228px] flex-col justify-between px-5 py-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Selected Sector</p>
              <p className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">{activeRow?.name ?? "—"}</p>
              <p className="mt-2 font-mono text-[13px] text-white/46">{activeRow?.etf ?? "—"}</p>
            </div>
            <div>
              <p className={clsx("text-[32px] font-semibold tracking-[-0.04em]", dashboardValueToneClass(activeRow?.performancePercent ?? null))}>
                {formatSignedPercent(activeRow?.performancePercent ?? null, 1)}
              </p>
              {activeRow?.signalStrength && activeRow.signalStrength !== "UNAVAILABLE" ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className={clsx("text-[10px] uppercase tracking-[0.14em]", signalStrengthClass(activeRow.signalStrength))}>
                    {activeRow.signalStrength === "CONSTRUCTIVE" ? "Constructive" : activeRow.signalStrength}
                  </span>
                  {typeof activeRow.signalScore === "number" ? (
                    <span className="text-[10px] uppercase tracking-[0.14em] text-white/42">
                      {activeRow.signalScore.toFixed(1)} signal
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black/25 px-4 pb-4 pt-5">
            <div className="pointer-events-none absolute inset-x-4 top-[18%] border-t border-dashed border-white/10" />
            <div className="pointer-events-none absolute inset-x-4 top-1/2 border-t border-white/12" />
            <div className="pointer-events-none absolute inset-x-4 bottom-[18%] border-t border-dashed border-white/10" />

            <div className="pointer-events-none absolute bottom-4 right-0 top-5 flex w-12 flex-col items-start justify-between text-[10px] text-white/34">
              <span>{formatSectorAxisLabel(axisAbsMax)}</span>
              <span>0%</span>
              <span>{formatSectorAxisLabel(-axisAbsMax)}</span>
            </div>

            <div className="mr-12 grid h-[228px] grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-11">
              {rows.map((sector) => {
                const raw = typeof sector.performancePercent === "number" && Number.isFinite(sector.performancePercent) ? sector.performancePercent : 0;
                const heightPercent = Math.max(10, (Math.abs(raw) / axisAbsMax) * 46);
                const isPositive = raw >= 0;
                const isActive = sector.etf === activeRow?.etf;

                return (
                  <button
                    key={`sector-map-${sector.etf}`}
                    type="button"
                    onMouseEnter={() => setHoveredEtf(sector.etf)}
                    onFocus={() => setHoveredEtf(sector.etf)}
                    className="group relative h-full rounded-[18px] px-1 pb-3 pt-2 text-center"
                  >
                    <div className={clsx("absolute inset-0 rounded-[18px] transition", isActive ? "bg-white/[0.06]" : "bg-transparent group-hover:bg-white/[0.035]")} />
                    <div
                      className={clsx(
                        "eldar-sector-bar absolute left-1/2 w-[68%] -translate-x-1/2 rounded-[10px]",
                        isPositive
                          ? "bg-gradient-to-t from-[#00D212] to-[#5CFF76] shadow-[0_0_18px_rgba(0,210,18,0.26)]"
                          : "bg-gradient-to-b from-[#FF7B2B] to-[#FF4D00] shadow-[0_0_18px_rgba(255,90,0,0.24)]",
                        isActive ? "opacity-100" : "opacity-72 group-hover:opacity-100"
                      )}
                      style={isPositive ? { bottom: "50%", height: `${heightPercent}%` } : { top: "50%", height: `${heightPercent}%` }}
                    />
                    <div className="absolute bottom-0 left-1/2 w-full -translate-x-1/2">
                      <p className={clsx("font-mono text-[11px] transition", isActive ? "text-white" : "text-white/68 group-hover:text-white")}>
                        {sector.etf}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function MarketMoverStack({
  items,
  onAnalyze
}: {
  items: HomeMarketMoverItem[];
  onAnalyze: (symbol: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState<"ALL" | "W" | "L">("ALL");
  const filteredItems = useMemo(() => {
    if (filter === "W") {
      return items
        .filter((item) => (item.changePercent ?? 0) > 0)
        .slice()
        .sort((left, right) => (right.changePercent ?? 0) - (left.changePercent ?? 0))
        .slice(0, 3);
    }
    if (filter === "L") {
      return items
        .filter((item) => (item.changePercent ?? 0) < 0)
        .slice()
        .sort((left, right) => (left.changePercent ?? 0) - (right.changePercent ?? 0))
        .slice(0, 3);
    }
    return items.slice(0, 3);
  }, [filter, items]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
        {(["ALL", "W", "L"] as const).map((option) => (
          <button
            key={`mover-filter-${option}`}
            type="button"
            onClick={() => setFilter(option)}
            aria-pressed={filter === option}
            className={clsx(
              "eldar-dashboard-pill rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.14em]",
              filter === option && "bg-white text-black hover:bg-white"
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center rounded-[24px] border border-dashed border-white/10 text-center text-sm text-white/46">
          No movers in this bucket.
        </div>
      ) : filteredItems.map((item) => (
        <button
          key={`market-mover-${item.symbol}`}
          type="button"
          onClick={() => onAnalyze(item.symbol)}
          className="eldar-dashboard-surface w-full px-4 py-3 text-left"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[14px] font-semibold text-white">{item.symbol}</p>
            </div>
            <div className="text-right">
              <p className={clsx("text-[13px] font-semibold", dashboardValueToneClass(item.changePercent ?? null))}>
                {formatSignedPercent(item.changePercent, 2)}
              </p>
              <p className="mt-1 text-[11px] text-white/38">
                {typeof item.currentPrice === "number" ? formatPrice(item.currentPrice, "USD") : "Price unavailable"}
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function MarketNewsPanel({ items }: { items: HomeNewsItem[] }): JSX.Element {
  return (
    <section className="eldar-panel texture-none p-6 xl:col-span-4">
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Market News</p>
      </div>

      {items.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center rounded-[24px] border border-dashed border-white/10 text-center text-sm text-white/46">
          No market headlines are available right now.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item, index) => {
            const content = <p className="text-[15px] font-medium leading-7 text-white/90">{item.headline}</p>;

            if (!item.url) {
              return (
                <div key={`${item.headline}-${index}`} className="eldar-dashboard-surface px-4 py-4 text-left">
                  {content}
                </div>
              );
            }

            return (
              <a
                key={`${item.headline}-${index}`}
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="eldar-dashboard-surface block px-4 py-4 text-left"
              >
                {content}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
