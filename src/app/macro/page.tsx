"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppLeftSidebar } from "@/components/AppLeftSidebar";
import { isPaletteOpenShortcut } from "@/lib/ui/command-palette";

const DASHBOARD_RETURN_STATE_KEY = "eldar:dashboard:return-state";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

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

function XBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.039 9.19L24 22.847h-7.406l-5.8-7.584-6.64 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zM17.61 20.644h2.039L6.486 3.24H4.298z" />
    </svg>
  );
}

function TelegramBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.62 8.17-1.95 9.19c-.15.65-.54.81-1.09.5l-3.02-2.23-1.46 1.41c-.16.16-.3.3-.62.3l.22-3.11 5.66-5.11c.25-.22-.05-.34-.38-.12l-7 4.41-3.02-.94c-.66-.2-.67-.66.14-.97l11.79-4.55c.55-.2 1.03.13.85.93z" />
    </svg>
  );
}

export default function MacroPage(): JSX.Element {
  const router = useRouter();
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [indicators, setIndicators] = useState<MacroIndicatorSnapshot[]>([]);

  const openDashboardView = useCallback((
    view: "home" | "portfolio" | "watchlist",
    ticker?: string,
    options?: { openPalette?: boolean; paletteAction?: "analyze" | "portfolio-add" | "compare-add" }
  ): void => {
    try {
      const payload = {
        savedAt: Date.now(),
        isAppOpen: true,
        view,
        ticker: ticker?.trim().toUpperCase() ?? "",
        openPalette: Boolean(options?.openPalette),
        paletteAction: options?.paletteAction ?? "analyze"
      };
      window.sessionStorage.setItem(DASHBOARD_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch {
      // no-op
    }

    router.push("/");
  }, [router]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("eldar-theme-mode");
      const mode = saved === "light" ? "light" : "dark";
      setThemeMode(mode);
      document.documentElement.dataset.theme = mode;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, [openDashboardView]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem("eldar-theme-mode", themeMode);
    } catch {
      // no-op
    }
  }, [themeMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isPaletteOpenShortcut(event)) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" });
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDashboardView]);

  useEffect(() => {
    let cancelled = false;

    const loadMacro = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");
        const response = await fetch("/api/macro/fred");
        const payload = (await response.json()) as { indicators?: MacroIndicatorSnapshot[]; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load macro indicators.");
        }
        setIndicators(Array.isArray(payload.indicators) ? payload.indicators : []);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load macro indicators.");
          setIndicators([]);
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
    if (valid.length === 0) {
      return {
        available: 0,
        total: indicators.length
      };
    }
    return {
      available: valid.length,
      total: indicators.length
    };
  }, [indicators]);

  const appBackground = themeMode === "dark" ? "#000000" : "#e9e5dc";

  return (
    <main className="min-h-screen overflow-x-hidden text-white" style={{ background: appBackground }}>
      <AppLeftSidebar
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
      />
      <div className="container mx-auto px-6 pb-20 pl-[104px] pr-10 pt-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="eldar-display text-2xl font-bold tracking-[0.14em] text-white md:text-3xl">MACRO</h1>
          </div>

          {error ? (
            <div className="mb-6 rounded-2xl border border-zinc-400/35 bg-zinc-300/10 px-4 py-3 text-sm text-zinc-100">{error}</div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {indicators.slice(0, 4).map((item) => {
              const tone = changeTone(item.change);
              return (
                <div key={`macro-top-${item.key}`} className="eldar-panel rounded-2xl p-6">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-white/55">{item.title}</p>
                  <p className="mt-3 text-4xl font-black leading-none text-white">{formatValue(item.value, item.unit)}</p>
                  <p
                    className={clsx(
                      "mt-3 text-sm",
                      tone === "positive" && "text-emerald-300",
                      tone === "negative" && "text-red-300",
                      tone === "neutral" && "text-white/70"
                    )}
                  >
                    {formatChange(item.change, item.changeMode)}
                  </p>
                  <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/50">{item.frequency} • {item.seriesId}</p>
                </div>
              );
            })}
          </div>

          <div className="eldar-panel mt-6 overflow-hidden rounded-3xl">
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
          </div>
        </div>
      </div>

      <footer className="hidden fixed bottom-0 left-0 right-0 z-40 border-t border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        <div className="container mx-auto px-6">
          <div className="flex h-10 items-center justify-between">
              <div className="flex items-center gap-2" />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
                className={clsx(
                  "eldar-theme-toggle rounded-lg border p-1.5 transition",
                  themeMode === "dark"
                    ? "border-amber-300/45 bg-amber-200/10 text-[#F5C451] hover:border-amber-200/75 hover:bg-amber-200/18"
                    : "border-sky-200/45 bg-sky-100/12 text-[#BCD4FF] hover:border-sky-100/75 hover:bg-sky-100/22"
                )}
                aria-label="Toggle theme"
                title="Toggle theme"
              >
                {themeMode === "dark" ? <Sun className="eldar-theme-glyph h-3.5 w-3.5" /> : <Moon className="eldar-theme-glyph h-3.5 w-3.5" />}
              </button>
              <a
                href="https://x.com/ELDAR_AI?s=20"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/80 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                aria-label="X"
                title="X"
              >
                <XBrandIcon />
              </a>
              <a
                href="https://t.me"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/80 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                aria-label="Telegram"
                title="Telegram"
              >
                <TelegramBrandIcon />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
