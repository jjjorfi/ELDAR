"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppPageHeader } from "@/components/AppPageHeader";
import { AppPageShell } from "@/components/AppPageShell";
import { useDashboardPaletteShortcut } from "@/hooks/useDashboardPaletteShortcut";
import { usePopupWheelScroll } from "@/hooks/usePopupWheelScroll";
import { useThemeMode } from "@/hooks/useThemeMode";
import { GICS_SECTORS, GICS_SECTOR_ORDER } from "@/lib/market/gics-sectors";
import { stashDashboardIntent } from "@/lib/ui/dashboard-intent";

const LOCAL_SECTOR_SENTIMENT_STORAGE_KEY = "eldar:sectors:sentiment";
const HOME_DASHBOARD_YTD_STORAGE_KEY = "eldar:home:dashboard:YTD";

interface SectorSentimentItem {
  etf: string;
  changePercent: number | null;
  sentiment: "bullish" | "neutral" | "bearish";
  asOfMs: number | null;
}

type SectorSortMode = "default" | "bias-desc" | "bias-asc" | "move-desc" | "move-asc";
type SectorViewMode = "heatmap" | "table";

function createDefaultSentimentMap(): Record<string, SectorSentimentItem> {
  const map: Record<string, SectorSentimentItem> = {};
  for (const row of GICS_SECTORS) {
    map[row.etf] = {
      etf: row.etf,
      changePercent: 0,
      sentiment: "neutral",
      asOfMs: null
    };
  }
  return map;
}

function classifySectorSentiment(changePercent: number | null): "bullish" | "neutral" | "bearish" {
  if (typeof changePercent !== "number") return "neutral";
  if (changePercent >= 0.35) return "bullish";
  if (changePercent <= -0.35) return "bearish";
  return "neutral";
}

function toSectorSentimentMap(items: SectorSentimentItem[]): Record<string, SectorSentimentItem> {
  const map = createDefaultSentimentMap();
  for (const item of items) {
    map[item.etf] = item;
  }
  return map;
}

function readCachedSectorSentimentMap(): Record<string, SectorSentimentItem> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LOCAL_SECTOR_SENTIMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sectors?: SectorSentimentItem[] };
    if (!Array.isArray(parsed.sectors) || parsed.sectors.length === 0) return null;
    return toSectorSentimentMap(parsed.sectors);
  } catch {
    return null;
  }
}

function readDashboardSectorSentimentMap(): Record<string, SectorSentimentItem> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(HOME_DASHBOARD_YTD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      payload?: {
        generatedAt?: string;
        sectorRotation?: Array<{
          etf?: string;
          performancePercent?: number | null;
        }>;
      };
    };
    const sectors = parsed.payload?.sectorRotation;
    if (!Array.isArray(sectors) || sectors.length === 0) return null;
    const asOfMs = parsed.payload?.generatedAt ? Date.parse(parsed.payload.generatedAt) : Date.now();
    const items: SectorSentimentItem[] = sectors
      .map((item) => {
        const etf = typeof item.etf === "string" ? item.etf.toUpperCase() : "";
        if (!etf) return null;
        const changePercent = typeof item.performancePercent === "number" ? item.performancePercent : null;
        return {
          etf,
          changePercent,
          sentiment: classifySectorSentiment(changePercent),
          asOfMs: Number.isFinite(asOfMs) ? asOfMs : null
        };
      })
      .filter((item): item is SectorSentimentItem => item !== null);

    return items.length > 0 ? toSectorSentimentMap(items) : null;
  } catch {
    return null;
  }
}

function writeCachedSectorSentiment(items: SectorSentimentItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      LOCAL_SECTOR_SENTIMENT_STORAGE_KEY,
      JSON.stringify({ storedAt: Date.now(), sectors: items })
    );
  } catch {
    // Optional cache write.
  }
}

function sentimentLabel(sentiment: "bullish" | "neutral" | "bearish"): string {
  if (sentiment === "bullish") return "BULLISH";
  if (sentiment === "bearish") return "BEARISH";
  return "NEUTRAL";
}

function sentimentClass(sentiment: "bullish" | "neutral" | "bearish"): string {
  if (sentiment === "bullish") return "text-emerald-300";
  if (sentiment === "bearish") return "text-red-300";
  return "text-amber-300";
}

function sentimentRank(sentiment: "bullish" | "neutral" | "bearish"): number {
  if (sentiment === "bullish") return 3;
  if (sentiment === "neutral") return 2;
  return 1;
}

function nextSortMode(current: SectorSortMode, target: "bias" | "move"): SectorSortMode {
  if (target === "bias") {
    if (current === "bias-desc") return "bias-asc";
    if (current === "bias-asc") return "default";
    return "bias-desc";
  }
  if (current === "move-desc") return "move-asc";
  if (current === "move-asc") return "default";
  return "move-desc";
}

function sortLabel(mode: SectorSortMode, target: "bias" | "move"): "—" | "↓" | "↑" {
  if (target === "bias") {
    if (mode === "bias-desc") return "↓";
    if (mode === "bias-asc") return "↑";
    return "—";
  }
  if (mode === "move-desc") return "↓";
  if (mode === "move-asc") return "↑";
  return "—";
}

function heatTileTone(sentiment: "bullish" | "neutral" | "bearish"): string {
  if (sentiment === "bullish") return "border-emerald-300/35 bg-emerald-300/10";
  if (sentiment === "bearish") return "border-red-300/35 bg-red-300/10";
  return "border-white/15 bg-zinc-950/45";
}

export default function SectorsPage(): JSX.Element {
  const router = useRouter();
  const fallbackSentimentMap = useMemo(() => createDefaultSentimentMap(), []);
  const [themeMode, setThemeMode] = useThemeMode();
  const [sentimentMap, setSentimentMap] = useState<Record<string, SectorSentimentItem>>(() => createDefaultSentimentMap());
  const [sentimentLoading, setSentimentLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SectorSortMode>("default");
  const [viewMode, setViewMode] = useState<SectorViewMode>("heatmap");
  const [activeSectorEtf, setActiveSectorEtf] = useState<string | null>(null);
  const handlePopupWheel = usePopupWheelScroll<HTMLElement>();

  const openDashboardView = useCallback((
    view: "home" | "portfolio" | "watchlist",
    ticker?: string,
    options?: {
      openPalette?: boolean;
      paletteAction?: "analyze" | "portfolio-add" | "compare-add";
      autoAnalyze?: boolean;
    }
  ): void => {
    stashDashboardIntent(view, ticker ?? "", options);
    router.push("/");
  }, [router]);

  const openMacroPage = useCallback((): void => {
    router.push("/macro");
  }, [router]);

  useDashboardPaletteShortcut(() => openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" }));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && activeSectorEtf) {
        event.preventDefault();
        setActiveSectorEtf(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSectorEtf]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const cachedMap = readCachedSectorSentimentMap() ?? readDashboardSectorSentimentMap();

    if (cachedMap) {
      setSentimentMap(cachedMap);
      setSentimentLoading(false);
    }

    const load = async (): Promise<void> => {
      try {
        if (!cachedMap) {
          setSentimentLoading(true);
        }
        const response = await fetch("/api/sectors/sentiment", {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as { sectors?: SectorSentimentItem[] };
        if (cancelled) return;
        const nextMap = toSectorSentimentMap(payload.sectors ?? []);
        setSentimentMap(nextMap);
        writeCachedSectorSentiment(payload.sectors ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!cancelled) {
          setSentimentMap((prev) => (Object.keys(prev).length > 0 ? prev : createDefaultSentimentMap()));
        }
      } finally {
        if (!cancelled) {
          setSentimentLoading(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 180_000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const biasRankMap = useMemo(() => {
    const ranked = [...GICS_SECTORS].sort((left, right) => {
      const leftSentiment = sentimentMap[left.etf]?.sentiment ?? "neutral";
      const rightSentiment = sentimentMap[right.etf]?.sentiment ?? "neutral";
      const scoreDelta = sentimentRank(rightSentiment) - sentimentRank(leftSentiment);
      if (scoreDelta !== 0) return scoreDelta;

      const leftMove = sentimentMap[left.etf]?.changePercent ?? 0;
      const rightMove = sentimentMap[right.etf]?.changePercent ?? 0;
      if (leftMove !== rightMove) return rightMove - leftMove;

      return (GICS_SECTOR_ORDER[left.etf] ?? 999) - (GICS_SECTOR_ORDER[right.etf] ?? 999);
    });

    const rankMap: Record<string, number> = {};
    ranked.forEach((row, index) => {
      rankMap[row.etf] = index + 1;
    });
    return rankMap;
  }, [sentimentMap]);

  const moveRankMap = useMemo(() => {
    const ranked = [...GICS_SECTORS].sort((left, right) => {
      const leftMove = sentimentMap[left.etf]?.changePercent ?? 0;
      const rightMove = sentimentMap[right.etf]?.changePercent ?? 0;
      if (leftMove !== rightMove) return rightMove - leftMove;
      return (GICS_SECTOR_ORDER[left.etf] ?? 999) - (GICS_SECTOR_ORDER[right.etf] ?? 999);
    });

    const rankMap: Record<string, number> = {};
    ranked.forEach((row, index) => {
      rankMap[row.etf] = index + 1;
    });
    return rankMap;
  }, [sentimentMap]);

  const sortedRows = useMemo(() => {
    const rows = [...GICS_SECTORS];
    if (sortMode === "default") return rows;

    return rows.sort((left, right) => {
      if (sortMode === "bias-desc" || sortMode === "bias-asc") {
        const leftRank = sentimentRank(sentimentMap[left.etf]?.sentiment ?? "neutral");
        const rightRank = sentimentRank(sentimentMap[right.etf]?.sentiment ?? "neutral");
        if (leftRank !== rightRank) {
          return sortMode === "bias-desc" ? rightRank - leftRank : leftRank - rightRank;
        }
      }

      if (sortMode === "move-desc" || sortMode === "move-asc") {
        const leftMove = sentimentMap[left.etf]?.changePercent ?? 0;
        const rightMove = sentimentMap[right.etf]?.changePercent ?? 0;
        if (leftMove !== rightMove) {
          return sortMode === "move-desc" ? rightMove - leftMove : leftMove - rightMove;
        }
      }

      return (GICS_SECTOR_ORDER[left.etf] ?? 999) - (GICS_SECTOR_ORDER[right.etf] ?? 999);
    });
  }, [sentimentMap, sortMode]);

  const activeSector = useMemo(() => {
    if (!activeSectorEtf) return null;
    const row = GICS_SECTORS.find((entry) => entry.etf === activeSectorEtf);
    if (!row) return null;
    return {
      row,
      live: sentimentMap[row.etf] ?? fallbackSentimentMap[row.etf]
    };
  }, [activeSectorEtf, fallbackSentimentMap, sentimentMap]);

  return (
    <AppPageShell
      activeView="sectors"
      themeMode={themeMode}
      loading={sentimentLoading}
      defaultSearchValue=""
      onQuickSearch={() => openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" })}
      onOpenDashboard={() => openDashboardView("home")}
      onOpenSectors={() => undefined}
      onOpenMacro={openMacroPage}
      onOpenJournal={() => router.push("/journal")}
      onOpenPortfolio={() => openDashboardView("portfolio")}
      onToggleTheme={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
    >
      <AppPageHeader
        eyebrow="Market Structure"
        title="Sectors"
        subtitle={sentimentLoading ? "Loading live sector ranking." : "All 11 GICS sectors with uniform ranking, heatmap, and drill-down context."}
        actions={
          <>
            <button
              type="button"
              onClick={() => setViewMode("heatmap")}
              className={clsx(
                "h-9 rounded-xl border px-3 text-[10px] uppercase tracking-[0.12em] transition",
                viewMode === "heatmap"
                  ? "border-white/35 bg-white/10 text-white"
                  : "border-white/20 bg-black/20 text-white/70 hover:text-white"
              )}
            >
              Heatmap
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={clsx(
                "h-9 rounded-xl border px-3 text-[10px] uppercase tracking-[0.12em] transition",
                viewMode === "table"
                  ? "border-white/35 bg-white/10 text-white"
                  : "border-white/20 bg-black/20 text-white/70 hover:text-white"
              )}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => openDashboardView("home", "SPY", { autoAnalyze: true })}
              className="primary-cta h-9 rounded-xl border px-3 text-[10px] uppercase tracking-[0.12em] text-white transition"
            >
              Compare to SPY
            </button>
          </>
        }
      />

      {viewMode === "heatmap" ? (
        <div className="grid gap-3 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedRows.map((row, index) => {
            const live = sentimentMap[row.etf] ?? fallbackSentimentMap[row.etf];
            const moveValue = typeof live.changePercent === "number" ? live.changePercent : 0;
            const biasRank = biasRankMap[row.etf] ?? (GICS_SECTOR_ORDER[row.etf] ?? 0) + 1;
            const moveRank = moveRankMap[row.etf] ?? (GICS_SECTOR_ORDER[row.etf] ?? 0) + 1;

            return (
              <button
                key={`tile-${row.etf}`}
                type="button"
                className={clsx(
                  "eldar-panel min-h-[148px] px-5 py-4 text-left transition hover:border-white/30",
                  heatTileTone(live.sentiment)
                )}
                onClick={() => setActiveSectorEtf(row.etf)}
                style={{ animation: `fadeUp 0.4s ease-out ${Math.min(index, 10) * 0.05}s both` }}
              >
                <div className="mb-2">
                  <p className="text-[9px] uppercase tracking-[0.14em] text-white/45">
                    #{biasRank} · {row.etf}
                  </p>
                  <p className="mt-2 text-base font-bold text-white">{row.displayName}</p>
                </div>
                <div className="mt-5">
                  <p
                    className={clsx(
                      "text-2xl font-black",
                      moveValue > 0 ? "text-emerald-300" : moveValue < 0 ? "text-red-300" : "text-white/75"
                    )}
                  >
                    {moveValue > 0 ? "+" : ""}
                    {moveValue.toFixed(2)}%
                  </p>
                  <p className={clsx("mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]", sentimentClass(live.sentiment))}>
                    {sentimentLabel(live.sentiment)}
                    <span className="ml-2 text-white/50">#{moveRank}</span>
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="eldar-panel overflow-hidden rounded-3xl">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-white/15 bg-white/[0.04]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-white/70">
                  <th className="px-4 py-3">Sector</th>
                  <th className="px-4 py-3">ETF</th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSortMode((prev) => nextSortMode(prev, "bias"))}
                      className="inline-flex items-center gap-2 text-left transition hover:text-white"
                    >
                      Bias
                      <span className="text-[11px] text-white/55">{sortLabel(sortMode, "bias")}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSortMode((prev) => nextSortMode(prev, "move"))}
                      className="inline-flex items-center gap-2 text-left transition hover:text-white"
                    >
                      Move
                      <span className="text-[11px] text-white/55">{sortLabel(sortMode, "move")}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3">Top Tickers</th>
                  <th className="px-4 py-3">Focus Area</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const live = sentimentMap[row.etf] ?? fallbackSentimentMap[row.etf];
                  const moveValue = typeof live.changePercent === "number" ? live.changePercent : 0;
                  const biasRank = biasRankMap[row.etf] ?? (GICS_SECTOR_ORDER[row.etf] ?? 0) + 1;
                  const moveRank = moveRankMap[row.etf] ?? (GICS_SECTOR_ORDER[row.etf] ?? 0) + 1;

                  return (
                    <tr
                      key={row.etf}
                      className="cursor-pointer border-b border-white/10 text-sm text-white/90 transition hover:bg-white/[0.03]"
                      onClick={() => setActiveSectorEtf(row.etf)}
                    >
                      <td className="px-4 py-3 font-semibold">{row.sector}</td>
                      <td className="px-4 py-3 font-mono text-white/80">{row.etf}</td>
                      <td className="px-4 py-3 font-semibold">
                        <span className={sentimentClass(live.sentiment)}>{sentimentLabel(live.sentiment)}</span>
                        <span className="ml-2 font-mono text-[10px] text-white/50">#{biasRank}</span>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <span className={clsx(moveValue > 0 ? "text-emerald-300" : moveValue < 0 ? "text-red-300" : "text-white/75")}>
                          {moveValue > 0 ? "+" : ""}
                          {moveValue.toFixed(2)}%
                        </span>
                        <span className="ml-2 text-[10px] text-white/50">#{moveRank}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {row.topTickers.map((symbol) => (
                            <button
                              key={`${row.etf}-${symbol}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDashboardView("home", symbol, { autoAnalyze: true });
                              }}
                              className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-white/75 transition hover:border-white/35 hover:text-white"
                            >
                              {symbol}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/75">{row.focusArea}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSector ? (
        <div className="fixed inset-0 z-[95]">
          <button
            type="button"
            aria-label="Close drawer"
            className="absolute inset-0 bg-black/45"
            onClick={() => setActiveSectorEtf(null)}
          />
          <aside onWheelCapture={handlePopupWheel} className="eldar-scrollbar card-grain rough-border absolute right-0 top-0 h-full w-full max-w-[480px] overflow-y-auto overscroll-contain border-l border-white/15 bg-[#0a0a0a] p-5 shadow-2xl shadow-black/70">
            <div className="sticky top-0 z-10 mb-4 flex items-center justify-between border-b border-white/10 bg-[#0a0a0a] pb-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Sector Detail</p>
                <p className="mt-1 font-semibold text-white">{activeSector.row.sector}</p>
                <p className="mt-0.5 font-mono text-xs text-white/65">{activeSector.row.etf}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSectorEtf(null)}
                className="eldar-btn-ghost min-h-[40px] rounded-xl px-3 text-xs font-semibold uppercase tracking-[0.12em]"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Bias</p>
                <p className={clsx("mt-1 text-sm font-semibold", sentimentClass(activeSector.live.sentiment))}>
                  {sentimentLabel(activeSector.live.sentiment)}
                </p>
              </div>
              <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Move</p>
                <p
                  className={clsx(
                    "mt-1 font-mono text-lg font-semibold",
                    (activeSector.live.changePercent ?? 0) > 0 && "text-emerald-300",
                    (activeSector.live.changePercent ?? 0) < 0 && "text-red-300",
                    activeSector.live.changePercent === null && "text-white"
                  )}
                >
                  {typeof activeSector.live.changePercent === "number"
                    ? `${activeSector.live.changePercent > 0 ? "+" : ""}${activeSector.live.changePercent.toFixed(2)}%`
                    : "Pending"}
                </p>
              </div>
              <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Focus Area</p>
                <p className="mt-1 text-sm text-white/78">{activeSector.row.focusArea}</p>
              </div>
              <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Top Tickers</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeSector.row.topTickers.map((symbol) => (
                    <button
                      key={`drawer-${activeSector.row.etf}-${symbol}`}
                      type="button"
                      onClick={() => openDashboardView("home", symbol, { autoAnalyze: true })}
                      className="rounded-md border border-white/20 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-white/80 transition hover:border-white/40 hover:text-white"
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </AppPageShell>
  );
}
