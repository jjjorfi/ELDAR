// AI CONTEXT TRACE
// Extracted home dashboard display modules from StockDashboard. These are
// presentational-only and intentionally keep the same visuals/behavior while
// shrinking the main dashboard component. Any data/state changes should stay in
// StockDashboard and flow in via props.

"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

import type {
  HomeMarketMoverItem,
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

function formatHomeMetricValue(metric: HomeRegimeMetric): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return "—";
  if (metric.key === "tenYearYield") return `${metric.value.toFixed(2)}%`;
  if (metric.key === "oil") return `$${metric.value.toFixed(2)}`;
  return metric.value.toFixed(2);
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

export function DashboardMetricTile({ metric }: { metric: HomeRegimeMetric }): JSX.Element {
  return (
    <div className="eldar-dashboard-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/42">{metric.label}</p>
      <p className="mt-3 text-[24px] font-semibold tracking-[-0.03em] text-white">{formatHomeMetricValue(metric)}</p>
      <p className={clsx("mt-2 text-[11px] font-medium", dashboardValueToneClass(metric.changePercent))}>
        {metric.changePercent === null ? "No session delta" : formatSignedPercent(metric.changePercent, 2)}
      </p>
    </div>
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
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Sector Rotation</p>
          <p className="mt-2 text-sm text-white/64">Leadership map by sector.</p>
        </div>
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
          <div className="eldar-dashboard-surface flex min-h-[252px] flex-col justify-between px-5 py-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Selected Sector</p>
              <p className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">{activeRow?.name ?? "—"}</p>
              <p className="mt-2 font-mono text-[13px] text-white/46">{activeRow?.etf ?? "—"}</p>
            </div>
            <div>
              <p className={clsx("text-[32px] font-semibold tracking-[-0.04em]", dashboardValueToneClass(activeRow?.performancePercent ?? null))}>
                {formatSignedPercent(activeRow?.performancePercent ?? null, 1)}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className={clsx("text-[10px] uppercase tracking-[0.14em]", signalStrengthClass(activeRow?.signalStrength ?? "UNAVAILABLE"))}>
                  {activeRow?.signalStrength === "CONSTRUCTIVE" ? "Constructive" : activeRow?.signalStrength ?? "UNAVAILABLE"}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/42">
                  {activeRow?.signalScore !== null && activeRow?.signalScore !== undefined
                    ? `${activeRow.signalScore.toFixed(1)} composite`
                    : "Signal score pending"}
                </span>
              </div>
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

            <div className="mr-12 grid h-[252px] grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-11">
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
  return (
    <div className="space-y-2.5">
      {items.slice(0, 3).map((item, index) => (
        <button
          key={`market-mover-${item.symbol}`}
          type="button"
          onClick={() => onAnalyze(item.symbol)}
          className="eldar-dashboard-surface w-full px-4 py-3 text-left"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/34">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="mt-2 font-mono text-[14px] font-semibold text-white">{item.symbol}</p>
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
