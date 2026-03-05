"use client";

import clsx from "clsx";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookText, Bookmark, BriefcaseBusiness, CircleUserRound, Grid2x2, Home, LineChart, Moon, Search, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { isTop100Sp500Symbol } from "@/lib/market/top100";

const ELDAR_BRAND_LOGO = "/brand/eldar-logo.png";
const DASHBOARD_RETURN_STATE_KEY = "eldar:dashboard:return-state";

interface SectorRow {
  sector: string;
  etf: string;
  topTickers: string;
  focusArea: string;
}

interface SectorSentimentItem {
  etf: string;
  changePercent: number | null;
  sentiment: "bullish" | "neutral" | "bearish";
  asOfMs: number | null;
}

type SectorSortMode = "default" | "bias-desc" | "bias-asc" | "move-desc" | "move-asc";
type SectorViewMode = "heatmap" | "table";

const SECTOR_ROWS: SectorRow[] = [
  { sector: "Information Tech", etf: "XLK", topTickers: "$AAPL, $MSFT, $NVDA, $AVGO", focusArea: "Software, Semi-conductors, Hardware" },
  { sector: "Financials", etf: "XLF", topTickers: "$JPM, $BRK.B, $V, $MA, $BAC", focusArea: "Banks, Insurance, Payment Processors" },
  { sector: "Health Care", etf: "XLV", topTickers: "$LLY, $UNH, $JNJ, $ABBV, $PFE", focusArea: "Pharma, Biotech, Managed Care" },
  { sector: "Cons. Discretionary", etf: "XLY", topTickers: "$AMZN, $TSLA, $HD, $MCD, $NKE", focusArea: "E-commerce, Autos, Retail, Travel" },
  { sector: "Comm. Services", etf: "XLC", topTickers: "$META, $GOOGL, $NFLX, $DIS, $VZ", focusArea: "Social Media, Search, Entertainment" },
  { sector: "Industrials", etf: "XLI", topTickers: "$CAT, $GE, $UPS, $HON, $BA", focusArea: "Aerospace, Defense, Logistics, Machining" },
  { sector: "Consumer Staples", etf: "XLP", topTickers: "$PG, $WMT, $KO, $PEP, $COST", focusArea: "Essential Goods, Beverages, Tobacco" },
  { sector: "Energy", etf: "XLE", topTickers: "$XOM, $CVX, $COP, $SLB", focusArea: "Oil & Gas Exploration, Equipment" },
  { sector: "Utilities", etf: "XLU", topTickers: "$NEE, $SO, $DUK, $SRE", focusArea: "Electric, Gas, & Water Providers" },
  { sector: "Real Estate", etf: "XLRE", topTickers: "$PLD, $AMT, $EQIX, $PSA", focusArea: "REITs, Data Centers, Cell Towers" },
  { sector: "Materials", etf: "XLB", topTickers: "$LIN, $SHW, $APD, $FCX", focusArea: "Chemicals, Mining, Construction Mat." }
];

const DEFAULT_ROW_ORDER: Record<string, number> = SECTOR_ROWS.reduce<Record<string, number>>((acc, row, index) => {
  acc[row.etf] = index;
  return acc;
}, {});

function createDefaultSentimentMap(): Record<string, SectorSentimentItem> {
  const map: Record<string, SectorSentimentItem> = {};
  for (const row of SECTOR_ROWS) {
    map[row.etf] = {
      etf: row.etf,
      changePercent: 0,
      sentiment: "neutral",
      asOfMs: null
    };
  }
  return map;
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

function extractTopTickers(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().replace("$", "").toUpperCase())
    .filter((symbol) => symbol.length > 0 && isTop100Sp500Symbol(symbol));
}

function heatTileTone(sentiment: "bullish" | "neutral" | "bearish"): string {
  if (sentiment === "bullish") return "border-emerald-300/35 bg-emerald-300/10";
  if (sentiment === "bearish") return "border-red-300/35 bg-red-300/10";
  return "border-white/15 bg-zinc-950/45";
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

export default function SectorsPage(): JSX.Element {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fallbackSentimentMap = useMemo(() => createDefaultSentimentMap(), []);
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [sentimentMap, setSentimentMap] = useState<Record<string, SectorSentimentItem>>(() => createDefaultSentimentMap());
  const [sentimentLoading, setSentimentLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SectorSortMode>("default");
  const [viewMode, setViewMode] = useState<SectorViewMode>("heatmap");

  function openDashboardView(
    view: "home" | "portfolio" | "watchlist",
    ticker?: string,
    options?: {
      openPalette?: boolean;
      paletteAction?: "analyze" | "portfolio-add" | "compare-add";
      autoAnalyze?: boolean;
    }
  ): void {
    try {
      const payload = {
        savedAt: Date.now(),
        isAppOpen: true,
        view,
        ticker: ticker?.trim().toUpperCase() ?? "",
        openPalette: Boolean(options?.openPalette),
        paletteAction: options?.paletteAction ?? "analyze",
        autoAnalyze: Boolean(options?.autoAnalyze)
      };
      window.sessionStorage.setItem(DASHBOARD_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch {
      // no-op
    }

    router.push("/");
  }

  function openMacroPage(): void {
    router.push("/macro");
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("eldar-theme-mode");
      const mode = saved === "light" ? "light" : "dark";
      setThemeMode(mode);
      document.documentElement.dataset.theme = mode;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem("eldar-theme-mode", themeMode);
    } catch {
      // no-op
    }
  }, [themeMode]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent): void => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    const refreshMarketStatus = (): void => {
      const now = new Date();
      const day = now.getDay();
      const hour = now.getHours();
      const minutes = now.getMinutes();
      const open = day >= 1 && day <= 5 && (hour > 9 || (hour === 9 && minutes >= 30)) && hour < 16;
      setIsMarketOpen(open);
    };

    refreshMarketStatus();
    const interval = window.setInterval(refreshMarketStatus, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        setSentimentLoading(true);
        const response = await fetch("/api/sectors/sentiment");
        const payload = (await response.json()) as { sectors?: SectorSentimentItem[] };
        if (cancelled) return;

        const nextMap = createDefaultSentimentMap();
        for (const item of payload.sectors ?? []) {
          nextMap[item.etf] = item;
        }
        setSentimentMap(nextMap);
      } catch {
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
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const biasRankMap = useMemo(() => {
    const ranked = [...SECTOR_ROWS].sort((left, right) => {
      const leftSentiment = sentimentMap[left.etf]?.sentiment ?? "neutral";
      const rightSentiment = sentimentMap[right.etf]?.sentiment ?? "neutral";
      const scoreDelta = sentimentRank(rightSentiment) - sentimentRank(leftSentiment);
      if (scoreDelta !== 0) return scoreDelta;

      const leftMove = sentimentMap[left.etf]?.changePercent ?? 0;
      const rightMove = sentimentMap[right.etf]?.changePercent ?? 0;
      if (leftMove !== rightMove) return rightMove - leftMove;

      return (DEFAULT_ROW_ORDER[left.etf] ?? 999) - (DEFAULT_ROW_ORDER[right.etf] ?? 999);
    });

    const rankMap: Record<string, number> = {};
    ranked.forEach((row, index) => {
      rankMap[row.etf] = index + 1;
    });
    return rankMap;
  }, [sentimentMap]);

  const moveRankMap = useMemo(() => {
    const ranked = [...SECTOR_ROWS].sort((left, right) => {
      const leftMove = sentimentMap[left.etf]?.changePercent ?? 0;
      const rightMove = sentimentMap[right.etf]?.changePercent ?? 0;
      if (leftMove !== rightMove) return rightMove - leftMove;
      return (DEFAULT_ROW_ORDER[left.etf] ?? 999) - (DEFAULT_ROW_ORDER[right.etf] ?? 999);
    });

    const rankMap: Record<string, number> = {};
    ranked.forEach((row, index) => {
      rankMap[row.etf] = index + 1;
    });
    return rankMap;
  }, [sentimentMap]);

  const sortedRows = useMemo(() => {
    const rows = [...SECTOR_ROWS];
    if (sortMode === "default") {
      return rows;
    }

    return rows.sort((left, right) => {
      if (sortMode === "bias-desc" || sortMode === "bias-asc") {
        const leftSentiment = sentimentMap[left.etf]?.sentiment ?? "neutral";
        const rightSentiment = sentimentMap[right.etf]?.sentiment ?? "neutral";
        const leftRank = sentimentRank(leftSentiment);
        const rightRank = sentimentRank(rightSentiment);
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

      return (DEFAULT_ROW_ORDER[left.etf] ?? 999) - (DEFAULT_ROW_ORDER[right.etf] ?? 999);
    });
  }, [sentimentMap, sortMode]);

  const appBackground = themeMode === "dark" ? "#000000" : "#e9e5dc";

  return (
    <main className="min-h-screen overflow-x-hidden text-white" style={{ background: appBackground }}>
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        <div className="container mx-auto px-6">
          <div className="flex h-16 items-center justify-between gap-3">
            <button type="button" onClick={() => router.push("/")} className="eldar-logo-button flex cursor-pointer items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden">
                <Image src={ELDAR_BRAND_LOGO} alt="ELDAR logo" fill sizes="40px" className="object-contain" priority />
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" })}
                title="Search"
                aria-label="Search"
                className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border text-slate-900 transition-all backdrop-blur-xl"
              >
                <Search className="h-4 w-4" />
              </button>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setIsMenuOpen((prev) => !prev)}
                  className={clsx(
                    "flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold transition-all backdrop-blur-xl",
                    isMenuOpen ? "eldar-btn-ghost border-white/60 bg-white/10 text-white" : "eldar-btn-silver text-slate-900"
                  )}
                  title="Menu"
                  aria-label="Menu"
                >
                  <Home className="h-4 w-4" />
                </button>
                {isMenuOpen ? (
                  <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-2xl border border-white/20 bg-zinc-950/90 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        openDashboardView("home");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <Home className="h-4 w-4" />
                      Home
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white transition hover:bg-white/10"
                    >
                      <Grid2x2 className="h-4 w-4" />
                      Sectors
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        openMacroPage();
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <LineChart className="h-4 w-4" />
                      Macro
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        router.push("/journal");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <BookText className="h-4 w-4" />
                      Journal
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        openDashboardView("portfolio");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <BriefcaseBusiness className="h-4 w-4" />
                      Portfolio
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => openDashboardView("watchlist")}
                className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border text-slate-900 transition-all backdrop-blur-xl"
                title="Watchlist"
                aria-label="Watchlist"
              >
                <Bookmark className="h-4 w-4" />
              </button>
              <SignedOut>
                <SignInButton mode="modal">
                  <button
                    type="button"
                    className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border text-slate-900 transition-all backdrop-blur-xl"
                    title="Profile"
                    aria-label="Profile"
                  >
                    <CircleUserRound className="h-4 w-4" />
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/30 bg-black/20 p-0.5 backdrop-blur-xl">
                  <UserButton afterSignOutUrl="/" />
                </div>
              </SignedIn>
            </div>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-6 pb-20 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="eldar-display text-2xl font-bold tracking-[0.14em] text-white md:text-3xl">SECTORS</h1>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-[0.14em] text-white/60">
                {sentimentLoading ? "Loading live sectors..." : "Live sector ranking"}
              </p>
              <button
                type="button"
                onClick={() => setViewMode("heatmap")}
                className={clsx(
                  "h-8 border px-3 text-[10px] uppercase tracking-[0.12em] transition",
                  viewMode === "heatmap"
                    ? "border-amber-300/35 bg-amber-200/10 text-amber-100"
                    : "border-white/20 bg-black/20 text-white/70 hover:text-white"
                )}
              >
                Heatmap
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={clsx(
                  "h-8 border px-3 text-[10px] uppercase tracking-[0.12em] transition",
                  viewMode === "table"
                    ? "border-amber-300/35 bg-amber-200/10 text-amber-100"
                    : "border-white/20 bg-black/20 text-white/70 hover:text-white"
                )}
              >
                Table
              </button>
            </div>
          </div>

          {viewMode === "heatmap" ? (
            <div className="grid gap-3 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedRows.map((row, index) => {
                const live = sentimentMap[row.etf] ?? fallbackSentimentMap[row.etf];
                const sentiment = live.sentiment;
                const moveValue = typeof live.changePercent === "number" ? live.changePercent : 0;
                const biasRank = biasRankMap[row.etf] ?? (DEFAULT_ROW_ORDER[row.etf] ?? 0) + 1;
                const moveRank = moveRankMap[row.etf] ?? (DEFAULT_ROW_ORDER[row.etf] ?? 0) + 1;
                return (
                  <div
                    key={`tile-${row.etf}`}
                    className={clsx(
                      "eldar-panel min-h-[148px] px-5 py-4 text-left",
                      heatTileTone(sentiment)
                    )}
                    style={{ animation: `fadeUp 0.4s ease-out ${Math.min(index, 10) * 0.05}s both` }}
                  >
                    <div className="mb-2">
                      <p className="text-[9px] uppercase tracking-[0.14em] text-white/45">
                        #{biasRank} · {row.etf}
                      </p>
                      <p className="mt-2 text-base font-bold text-white">{row.sector}</p>
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
                      <p className={clsx("mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]", sentimentClass(sentiment))}>
                        {sentimentLabel(sentiment)}
                        <span className="ml-2 text-white/50">#{moveRank}</span>
                      </p>
                    </div>
                  </div>
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
                      <th className="px-4 py-3">Top $Tickers</th>
                      <th className="px-4 py-3">Focus Area</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => {
                      const live = sentimentMap[row.etf] ?? fallbackSentimentMap[row.etf];
                      const sentiment = live.sentiment;
                      const moveValue = typeof live.changePercent === "number" ? live.changePercent : 0;
                      const move = `${moveValue > 0 ? "+" : ""}${moveValue.toFixed(2)}%`;
                      const biasRank = biasRankMap[row.etf] ?? (DEFAULT_ROW_ORDER[row.etf] ?? 0) + 1;
                      const moveRank = moveRankMap[row.etf] ?? (DEFAULT_ROW_ORDER[row.etf] ?? 0) + 1;

                      return (
                        <tr key={row.sector} className="border-b border-white/10 text-sm text-white/90">
                          <td className="px-4 py-3 font-semibold">{row.sector}</td>
                          <td className="px-4 py-3 font-mono text-white/80">{row.etf}</td>
                          <td className="px-4 py-3 font-semibold">
                            <span className={sentimentClass(sentiment)}>{sentimentLabel(sentiment)}</span>
                            <span className="ml-2 font-mono text-[10px] text-white/50">#{biasRank}</span>
                          </td>
                          <td className="px-4 py-3 font-mono">
                            <span
                              className={clsx(
                                moveValue > 0 ? "text-emerald-300" : moveValue < 0 ? "text-red-300" : "text-white/75"
                              )}
                            >
                              {move}
                            </span>
                            <span className="ml-2 text-[10px] text-white/50">#{moveRank}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {extractTopTickers(row.topTickers).map((symbol) => (
                                <button
                                  key={`${row.etf}-${symbol}`}
                                  type="button"
                                  onClick={() => openDashboardView("home", symbol, { autoAnalyze: true })}
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
        </div>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        <div className="container mx-auto px-6">
          <div className="flex h-10 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="eldar-status-star eldar-status-live" />
              <span className="eldar-caption text-[8px] text-white/50">LIVE | {isMarketOpen ? "Market Open" : "Market Closed"}</span>
            </div>
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
