"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppPageHeader } from "@/components/AppPageHeader";
import { AppPageShell } from "@/components/AppPageShell";
import {
  MacroGateStatusRow,
  MacroPillarGrid,
  MacroRegimeNeedlePanel,
  RawDataSection
} from "@/components/macro/MacroRegimePanels";
import { useDashboardPaletteShortcut } from "@/hooks/useDashboardPaletteShortcut";
import { useThemeMode } from "@/hooks/useThemeMode";
import type { HomeDashboardPayload } from "@/lib/home/dashboard-types";
import { stashDashboardIntent } from "@/lib/ui/dashboard-intent";

interface MacroIndicatorSnapshot {
  key: string;
  title: string;
  seriesId: string;
  unit: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  value: number | null;
  date: string | null;
  change: number | null;
  changeMode: "yoy_pct" | "qoq_pct" | "mom_pct" | "delta_pp" | "delta_abs";
}

function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "Index") return value.toFixed(2);
  if (unit === "Thousands") return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (unit.includes("Billions")) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (unit.includes("Millions")) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatChange(value: number | null, mode: MacroIndicatorSnapshot["changeMode"]): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (mode === "delta_abs") return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (mode === "delta_pp") return `${value > 0 ? "+" : ""}${value.toFixed(2)} pp`;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function changeTone(value: number | null): "positive" | "neutral" | "negative" {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

export default function MacroPage(): JSX.Element {
  const router = useRouter();
  const [themeMode, setThemeMode] = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [indicators, setIndicators] = useState<MacroIndicatorSnapshot[]>([]);
  const [macroRegime, setMacroRegime] = useState<HomeDashboardPayload["regime"] | null>(null);

  const openDashboardView = useCallback((
    view: "home" | "portfolio" | "watchlist",
    ticker?: string,
    options?: { openPalette?: boolean; paletteAction?: "analyze" | "portfolio-add" | "compare-add" }
  ): void => {
    stashDashboardIntent(view, ticker ?? "", options);
    router.push("/");
  }, [router]);

  useDashboardPaletteShortcut(() => openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" }));

  useEffect(() => {
    let cancelled = false;

    const loadMacro = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");
        const response = await fetch("/api/macro/fred");
        const payload = (await response.json()) as {
          indicators?: MacroIndicatorSnapshot[];
          macroRegime?: HomeDashboardPayload["regime"] | null;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load macro indicators.");
        }
        setIndicators(Array.isArray(payload.indicators) ? payload.indicators : []);
        setMacroRegime(payload.macroRegime ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load macro indicators.");
          setIndicators([]);
          setMacroRegime(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadMacro();
    const interval = window.setInterval(() => {
      void loadMacro();
    }, 180_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const macroSummary = useMemo(() => {
    const valid = indicators.filter((item) => item.value !== null);
    return {
      available: valid.length,
      total: indicators.length
    };
  }, [indicators]);

  return (
    <AppPageShell
      activeView="macro"
      themeMode={themeMode}
      loading={loading}
      defaultSearchValue=""
      onQuickSearch={() => openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" })}
      onOpenDashboard={() => openDashboardView("home")}
      onOpenSectors={() => router.push("/sectors")}
      onOpenMacro={() => undefined}
      onOpenJournal={() => router.push("/journal")}
      onOpenPortfolio={() => openDashboardView("portfolio")}
      onToggleTheme={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
    >
      <AppPageHeader
        eyebrow="Macro Monitor"
        title="Macro"
        subtitle={undefined}
      />

      {error ? (
        <div className="eldar-page-section mb-6 px-4 py-3 text-sm text-zinc-100">{error}</div>
      ) : null}

      <div className="space-y-4">
        {macroRegime ? (
          <>
            <MacroRegimeNeedlePanel regime={macroRegime} />
            <MacroPillarGrid regime={macroRegime} />
            <MacroGateStatusRow gatesFired={macroRegime.gatesFired} />
          </>
        ) : (
          <div className="eldar-page-section p-6">
            <p className="text-sm text-white/62">{loading ? "Loading macro regime..." : "Macro regime is unavailable."}</p>
          </div>
        )}

        <RawDataSection count={indicators.length}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-white/15 bg-white/[0.04]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-white/70">
                  <th className="px-4 py-3">Indicator</th>
                  <th className="px-4 py-3">Latest</th>
                  <th className="px-4 py-3">Move</th>
                  <th className="px-4 py-3">Frequency</th>
                  <th className="px-4 py-3">Series</th>
                  <th className="px-4 py-3">As Of</th>
                </tr>
              </thead>
              <tbody>
                {indicators.map((item) => {
                  const tone = changeTone(item.change);
                  return (
                    <tr key={item.key} className="border-b border-white/10 text-sm text-white/90">
                      <td className="px-4 py-3 font-semibold">{item.title}</td>
                      <td className="px-4 py-3 font-mono text-white/85">{formatValue(item.value, item.unit)}</td>
                      <td
                        className={clsx(
                          "px-4 py-3 font-mono",
                          tone === "positive" && "text-emerald-300",
                          tone === "negative" && "text-red-300",
                          tone === "neutral" && "text-white/75"
                        )}
                      >
                        {formatChange(item.change, item.changeMode)}
                      </td>
                      <td className="px-4 py-3 text-white/70">{item.frequency}</td>
                      <td className="px-4 py-3 font-mono text-white/70">{item.seriesId}</td>
                      <td className="px-4 py-3 text-white/70">{item.date ?? "N/A"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </RawDataSection>
      </div>
    </AppPageShell>
  );
}
