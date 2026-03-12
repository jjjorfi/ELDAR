"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Search,
  Share2,
  Star,
  X,
  Trash2
} from "lucide-react";

import { CompanyLogo } from "@/components/CompanyLogo";
import { PortfolioRatingPanel } from "@/components/portfolio";
import {
  ComparisonCard,
  PortfolioXRayCard,
  SignalCard,
  type ComparisonStock,
  type PortfolioXRayCardProps,
  type SignalCardProps
} from "@/components/share-cards";
import {
  EmptyState,
  LinesSkeleton,
  RatingCardSkeleton
} from "@/components/ui/FintechPrimitives";
import { SignalHero } from "@/components/ui/AnalysisPrimitives";
import { ScoreExplanationWidget } from "@/components/eldar/widgets";
import {
  MacroEnvironmentCard,
  MarketSnapshotChart,
  MarketNewsPanel,
  MarketMoverStack,
  SectorRotationBoard
} from "@/components/dashboard/HomeDashboardModules";
import { HeroLanding } from "@/components/landing/HeroLanding";
import { NavigationSidebar } from "@/components/stock-dashboard/NavigationSidebar";
import {
  PortfolioHoldingDrawer,
  PortfolioMainPanel
} from "@/components/stock-dashboard/PortfolioPanels";
import { ResultsChartsPanel } from "@/components/stock-dashboard/ResultsChartsPanel";
import { ResultsSidebar } from "@/components/stock-dashboard/ResultsSidebar";
import {
  areMag7CardsEqual,
  factorActionHint,
  factorSignalToneClass,
  findFactorMetric,
  findFactorSignal,
  formatSignedPercent,
  isTypingTarget,
  mergeIndexRows,
  ratioToPercentPoints,
  readCachedHomeDashboard,
  sectorRelativeState,
  writeCachedHomeDashboard
} from "@/components/stock-dashboard/data-helpers";
import {
  AnalysisRadarOverlay,
  HackingScore,
  HackingValueText,
  buildComparisonFactorTuple,
  buildSparklinePath,
  dedupeSearchResultsBySymbol,
  describeDonutSlicePath,
  formatChartDate,
  formatEarningsDate,
  formatOptionalDecimal,
  percentWithSign,
  ratingLabelFromKey,
  ratingLabelToneClass,
  ratingToneByLabel,
  scoreBandColor,
  scoreLabel,
  sectorHeatFromScore,
  sectorHeatLabel,
  sortMag7Cards,
  toConfidenceLevel
} from "@/components/stock-dashboard/view-helpers";
import type {
  AnalysisPhase,
  AuthMode,
  ComparisonState,
  HomeTickerDrawerState,
  IndexYtdItem,
  JournalRelatedEntry,
  LiveQuotePollRow,
  MarketMoverItem,
  PaletteAction,
  PortfolioHolding,
  PriceHistoryPoint,
  SearchResultItem,
  StockContextData,
  StockDashboardProps,
  ThemeMode,
  UpcomingEarningsItem,
  ViewMode
} from "@/components/stock-dashboard/types";
import { RATING_BANDS, toRating } from "@/lib/rating";
import { scorePortfolio } from "@/lib/scoring/portfolio/engine";
import type { PersistedPortfolioSnapshot, PortfolioEngineInput, PortfolioInputHolding } from "@/lib/scoring/portfolio/types";
import {
  SOCKET_EVENTS,
  type EarningsPayload,
  type IndicesYtdPayload,
  type Mag7Payload,
  type MarketMoversPayload,
  type QuoteTicksPayload,
  type WatchlistDeltaPayload
} from "@/lib/realtime/events";
import type { FactorResult, Mag7ScoreCard, PersistedAnalysis, RatingLabel, WatchlistItem } from "@/lib/types";
import { formatMarketCap, formatPrice } from "@/lib/utils";
import type {
  HomeDashboardPayload,
  SectorRotationWindow
} from "@/lib/home/dashboard-types";
import { exportCard } from "@/lib/share/export-card";
import { DASHBOARD_RETURN_STATE_KEY } from "@/lib/ui/dashboard-intent";
import { isPaletteOpenShortcut } from "@/lib/ui/command-palette";
import { pushRecentTicker } from "@/lib/ui/recent-tickers";
import type { PriceRange } from "@/lib/features/price/types";
import { usePopupWheelScroll } from "@/hooks/usePopupWheelScroll";
import { useSocket } from "@/hooks/useSocket";

const POPULAR_STOCKS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];
const FALLBACK_UPCOMING_EARNINGS: UpcomingEarningsItem[] = [
  { symbol: "AAPL", companyName: "Apple Inc.", date: null, epsEstimate: null },
  { symbol: "MSFT", companyName: "Microsoft Corporation", date: null, epsEstimate: null },
  { symbol: "NVDA", companyName: "NVIDIA Corporation", date: null, epsEstimate: null }
];
const FALLBACK_INDICES_YTD: IndexYtdItem[] = [
  { code: "US2000", label: "RUT", symbol: "^RUT", current: null, ytdChangePercent: null, asOf: null, points: [] },
  { code: "US100", label: "US100", symbol: "^NDX", current: null, ytdChangePercent: null, asOf: null, points: [] },
  { code: "US500", label: "US500", symbol: "^GSPC", current: null, ytdChangePercent: null, asOf: null, points: [] }
];
const COMMAND_PALETTE_LIMIT = 12;
const JOURNAL_VISIBLE_COUNT = 5;
const PRICE_RANGE_OPTIONS: PriceRange[] = ["1W", "1M", "3M", "1Y"];
const SHORTCUTS = [
  { key: "/", description: "Open search" },
  { key: "S", description: "Search stocks" },
  { key: "P", description: "Go to portfolio" },
  { key: "J", description: "New journal entry" },
  { key: "Esc", description: "Close modal / panel" }
];

const ELDAR_BRAND_LOGO = "/brand/eldar-logo.png";
const ANALYSIS_CACHE_TTL_MS = 90_000;
const LOCAL_WATCHLIST_STORAGE_KEY = "eldar:watchlist:local";
const LOCAL_INDICES_STORAGE_KEY = "eldar:indices:ytd";
const QUOTE_STREAM_IDLE_THRESHOLD_MS = 8_000;
const QUOTE_HTTP_POLL_INTERVAL_MS = 2_000;
const QUOTE_HTTP_POLL_TICK_MS = 1_000;
const QUOTE_HTTP_POLL_TIMEOUT_MS = 1_500;
const QUOTE_HTTP_POLL_SYMBOL_LIMIT = 24;

export function StockDashboard({
  initialHistory,
  initialWatchlist,
  initialMag7Scores,
  currentUserId,
  initialSymbol = null
}: StockDashboardProps): JSX.Element {
  const router = useRouter();
  const [isAppOpen, setIsAppOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");
  const [ticker, setTicker] = useState(initialSymbol ? initialSymbol.toUpperCase() : "");
  const [loading, setLoading] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle");
  const [currentRating, setCurrentRating] = useState<PersistedAnalysis | null>(initialHistory[0] ?? null);
  const [history, setHistory] = useState<PersistedAnalysis[]>(initialHistory);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(initialWatchlist);
  const [watchlistAddedSymbol, setWatchlistAddedSymbol] = useState<string | null>(null);
  const [apiError, setApiError] = useState("");
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const [mag7Cards, setMag7Cards] = useState<Mag7ScoreCard[]>(() => sortMag7Cards(initialMag7Scores));
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [paletteAction, setPaletteAction] = useState<PaletteAction>("analyze");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteResults, setPaletteResults] = useState<SearchResultItem[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [paletteError, setPaletteError] = useState("");
  const [paletteSelectionIndex, setPaletteSelectionIndex] = useState(0);
  const [stockContext, setStockContext] = useState<StockContextData | null>(null);
  const [stockContextLoading, setStockContextLoading] = useState(false);
  const [stockContextError, setStockContextError] = useState("");
  const [journalRelatedEntries, setJournalRelatedEntries] = useState<JournalRelatedEntry[]>([]);
  const [journalRelatedLoading, setJournalRelatedLoading] = useState(false);
  const [journalRelatedError, setJournalRelatedError] = useState("");
  const [, setResultsContextReady] = useState(true);
  const [marketMovers, setMarketMovers] = useState<MarketMoverItem[]>([]);
  const [marketMoversLoading, setMarketMoversLoading] = useState(false);
  const [homeDashboard, setHomeDashboard] = useState<HomeDashboardPayload | null>(null);
  const [homeDashboardLoading, setHomeDashboardLoading] = useState(false);
  const [homeDashboardError, setHomeDashboardError] = useState("");
  const [sectorRotationWindow, setSectorRotationWindow] = useState<SectorRotationWindow>("YTD");
  const [indicesYtd, setIndicesYtd] = useState<IndexYtdItem[]>(FALLBACK_INDICES_YTD);
  const [indicesError, setIndicesError] = useState("");
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [upcomingEarnings, setUpcomingEarnings] = useState<UpcomingEarningsItem[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState("");
  const [homeHeaderVisible, setHomeHeaderVisible] = useState(false);
  const [isNewsExpanded, setIsNewsExpanded] = useState(false);
  const [showAllJournalLinks, setShowAllJournalLinks] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [priceRange, setPriceRange] = useState<PriceRange>("3M");
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [priceHistoryChangePercent, setPriceHistoryChangePercent] = useState<number | null>(null);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryError, setPriceHistoryError] = useState("");
  const [priceChartHoverIndex, setPriceChartHoverIndex] = useState<number | null>(null);
  const [scoreChartHoverIndex, setScoreChartHoverIndex] = useState<number | null>(null);
  const [homeTickerDrawer, setHomeTickerDrawer] = useState<HomeTickerDrawerState | null>(null);
  const [portfolioInputTicker, setPortfolioInputTicker] = useState("");
  const [portfolioInputShares, setPortfolioInputShares] = useState("1");
  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHolding[]>([]);
  const [portfolioDrawerHoldingId, setPortfolioDrawerHoldingId] = useState<string | null>(null);
  const [portfolioWheelHoverId, setPortfolioWheelHoverId] = useState<string | null>(null);
  const [persistedPortfolioSnapshot, setPersistedPortfolioSnapshot] = useState<PersistedPortfolioSnapshot | null>(null);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [comparisonSymbols, setComparisonSymbols] = useState<string[]>([]);
  const [comparisonStateBySymbol, setComparisonStateBySymbol] = useState<Record<string, ComparisonState>>({});
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareCardKind, setShareCardKind] = useState<"signal" | "portfolio" | "comparison">("signal");
  const [shareExporting, setShareExporting] = useState(false);
  const [shareError, setShareError] = useState("");
  const heroSectionRef = useRef<HTMLDivElement | null>(null);
  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  const handlePopupWheel = usePopupWheelScroll<HTMLElement>();
  const shareCardRef = useRef<HTMLDivElement | null>(null);
  const paletteCacheRef = useRef<Map<string, SearchResultItem[]>>(new Map());
  const analysisCacheRef = useRef<Map<string, { analysis: PersistedAnalysis; expiresAt: number }>>(new Map());
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisRequestRef = useRef(0);
  const portfolioPersistTimeoutRef = useRef<number | null>(null);
  const portfolioPersistHashRef = useRef<string | null>(null);
  const portfolioHydratedFromServerRef = useRef(false);
  const watchlistHintTimeoutRef = useRef<number | null>(null);
  const priceHistoryCacheRef = useRef<Map<string, { points: PriceHistoryPoint[]; changePercent: number | null }>>(new Map());
  const homeDashboardLoadedRef = useRef(false);
  const quoteTickLastSeenRef = useRef<number>(Date.now());
  const quotePollInFlightRef = useRef(false);
  const quotePollLastRunRef = useRef(0);
  const quotePollAbortRef = useRef<AbortController | null>(null);
  const quotePollSymbolsRef = useRef<string[]>([]);
  const quoteFallbackActiveRef = useRef(false);
  const mouseRafRef = useRef<number | null>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseLastPaintRef = useRef(0);
  const analyzeSymbolRef = useRef<(symbol?: string) => Promise<void>>(async () => {});
  const deferredPaletteQuery = useDeferredValue(paletteQuery);
  const appBackground = "var(--eldar-bg-primary)";
  const portfolioStorageKey = useMemo(
    () => `eldar-portfolio-holdings:${currentUserId ?? "anon"}`,
    [currentUserId]
  );
  const localWatchlistStorageKey = `${LOCAL_WATCHLIST_STORAGE_KEY}:${currentUserId ?? "anon"}`;
  const { socket, status: socketStatus, error: socketError } = useSocket({
    enabled: isAppOpen
  });
  const liveQuotePollSymbols = useMemo(() => {
    const symbols = new Set<string>();
    const add = (value: string | null | undefined): void => {
      const normalized = (value ?? "").trim().toUpperCase();
      if (!normalized) return;
      symbols.add(normalized);
    };

    add(ticker);
    add(currentRating?.symbol);
    add(homeTickerDrawer?.symbol);
    for (const mover of marketMovers) add(mover.symbol);
    for (const card of mag7Cards) add(card.symbol);
    for (const holding of portfolioHoldings) add(holding.symbol);

    return Array.from(symbols).slice(0, QUOTE_HTTP_POLL_SYMBOL_LIMIT);
  }, [ticker, currentRating?.symbol, homeTickerDrawer?.symbol, marketMovers, mag7Cards, portfolioHoldings]);
  const headerVisible = view === "home" ? homeHeaderVisible : true;
  const showFadeTransition = view === "home";

  useEffect(() => {
    quotePollSymbolsRef.current = liveQuotePollSymbols;
  }, [liveQuotePollSymbols]);

  const applyLiveQuoteMap = useCallback((bySymbol: Map<string, { price: number; asOfMs: number }>): void => {
    if (bySymbol.size === 0) return;

    setCurrentRating((prev) => {
      if (!prev) return prev;
      const live = bySymbol.get(prev.symbol.toUpperCase());
      if (!live) return prev;
      if (Math.abs(prev.currentPrice - live.price) < 0.0001) return prev;
      return {
        ...prev,
        currentPrice: live.price
      };
    });

    setMarketMovers((prev) =>
      prev.map((item) => {
        const live = bySymbol.get(item.symbol.toUpperCase());
        if (!live) return item;
        if (item.currentPrice !== null && Math.abs(item.currentPrice - live.price) < 0.0001) return item;
        return {
          ...item,
          currentPrice: live.price
        };
      })
    );

    setMag7Cards((prev) =>
      sortMag7Cards(
        prev.map((card) => {
          const live = bySymbol.get(card.symbol.toUpperCase());
          if (!live) return card;
          if (Math.abs(card.currentPrice - live.price) < 0.0001) return card;
          return {
            ...card,
            currentPrice: live.price
          };
        })
      )
    );

    setHomeTickerDrawer((prev) => {
      if (!prev) return prev;
      const live = bySymbol.get(prev.symbol.toUpperCase());
      if (!live) return prev;
      if (prev.currentPrice !== null && Math.abs(prev.currentPrice - live.price) < 0.0001) return prev;
      return {
        ...prev,
        currentPrice: live.price
      };
    });

    setPortfolioHoldings((prev) =>
      prev.map((holding) => {
        if (!holding.analysis) return holding;
        const live = bySymbol.get(holding.symbol.toUpperCase());
        if (!live) return holding;
        if (Math.abs(holding.analysis.currentPrice - live.price) < 0.0001) return holding;
        return {
          ...holding,
          analysis: {
            ...holding.analysis,
            currentPrice: live.price
          }
        };
      })
    );
  }, []);

  const closeCommandPalette = useCallback((): void => {
    setIsCommandPaletteOpen(false);
    setPaletteError("");
    setPaletteAction("analyze");
  }, []);

  const closeProfileModal = useCallback((): void => {
    setIsProfileOpen(false);
  }, []);

  const closeShareModal = useCallback((): void => {
    setShareModalOpen(false);
    setShareError("");
    setShareExporting(false);
  }, []);

  const openShareModal = useCallback((kind: "signal" | "portfolio" | "comparison"): void => {
    setShareCardKind(kind);
    setShareError("");
    setShareModalOpen(true);
  }, []);

  const openCommandPalette = useCallback((prefill?: string, action: PaletteAction = "analyze"): void => {
    setPaletteQuery(prefill ?? ticker);
    setPaletteError("");
    setPaletteAction(action);
    setIsProfileOpen(false);
    setIsCommandPaletteOpen(true);
  }, [ticker]);

  const openApp = useCallback((): void => {
    setIsAppOpen(true);
    setView("home");
  }, []);

  function toggleThemeMode(): void {
    setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
  }

  function goHomeView(): void {
    setView("home");
    setCurrentRating(null);
    setApiError("");
  }

  function openProfileModal(mode: AuthMode = "login"): void {
    setAuthMode(mode);
    closeCommandPalette();
    setIsProfileOpen(true);
  }

  const saveReturnState = useCallback((): void => {
    try {
      const payload = {
        savedAt: Date.now(),
        isAppOpen,
        view,
        ticker,
        currentRating
      };
      window.sessionStorage.setItem(DASHBOARD_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch {
      // no-op
    }
  }, [isAppOpen, view, ticker, currentRating]);

  const openSectorsPage = useCallback((): void => {
    saveReturnState();
    router.push("/sectors");
  }, [router, saveReturnState]);

  const openMacroPage = useCallback((): void => {
    saveReturnState();
    router.push("/macro");
  }, [router, saveReturnState]);

  const openJournalPage = useCallback((options?: { symbol?: string; type?: string; entryId?: string }): void => {
    saveReturnState();
    const params = new URLSearchParams();
    if (options?.symbol) params.set("symbol", options.symbol.toUpperCase());
    if (options?.type) params.set("type", options.type);
    if (options?.entryId) params.set("entryId", options.entryId);
    const query = params.toString();
    router.push(query ? `/journal?${query}` : "/journal");
  }, [router, saveReturnState]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("eldar-theme-mode");
      const initialMode: ThemeMode = saved === "light" ? "light" : "dark";
      setThemeMode(initialMode);
      document.documentElement.dataset.theme = initialMode;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(DASHBOARD_RETURN_STATE_KEY);
      if (!raw) return;

      window.sessionStorage.removeItem(DASHBOARD_RETURN_STATE_KEY);
      const parsed = JSON.parse(raw) as {
        savedAt?: number;
        isAppOpen?: boolean;
        view?: ViewMode;
        ticker?: string;
        currentRating?: PersistedAnalysis | null;
        openPalette?: boolean;
        paletteAction?: PaletteAction;
        autoAnalyze?: boolean;
      };

      if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > 1000 * 60 * 60) {
        return;
      }

      if (parsed.isAppOpen) {
        setIsAppOpen(true);
      }

      if (parsed.view === "home" || parsed.view === "results" || parsed.view === "watchlist" || parsed.view === "portfolio") {
        setView(parsed.view);
      }

      if (typeof parsed.ticker === "string") {
        setTicker(parsed.ticker);
      }

      if (parsed.currentRating) {
        setCurrentRating(parsed.currentRating);
        setHistory((prev) => {
          const without = prev.filter((item) => item.id !== parsed.currentRating?.id);
          return [parsed.currentRating as PersistedAnalysis, ...without];
        });
      }

      if (parsed.openPalette) {
        const action = parsed.paletteAction ?? "analyze";
        const prefill = typeof parsed.ticker === "string" ? parsed.ticker : "";
        window.setTimeout(() => {
          // Restore palette state directly to avoid stale callback dependencies.
          setPaletteQuery(prefill);
          setPaletteError("");
          setPaletteAction(action);
          setIsProfileOpen(false);
          setIsCommandPaletteOpen(true);
        }, 0);
      }

      if (parsed.autoAnalyze && typeof parsed.ticker === "string" && parsed.ticker.trim().length > 0) {
        const symbol = parsed.ticker.trim().toUpperCase();
        window.setTimeout(() => {
          void analyzeSymbolRef.current(symbol);
        }, 0);
      }
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    if (!isAppOpen) return;
    if (!initialSymbol) return;
    const symbol = initialSymbol.trim().toUpperCase();
    if (!symbol) return;
    setTicker(symbol);
    window.setTimeout(() => {
      void analyzeSymbolRef.current(symbol);
    }, 0);
  }, [initialSymbol, isAppOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem("eldar-theme-mode", themeMode);
    } catch {
      // no-op
    }
  }, [themeMode]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_INDICES_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as IndexYtdItem[];
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      const normalized = parsed
        .map((item) => ({
          code: item.code,
          label: item.label,
          symbol: item.symbol,
          current: typeof item.current === "number" ? item.current : null,
          ytdChangePercent: typeof item.ytdChangePercent === "number" ? item.ytdChangePercent : null,
          asOf: typeof item.asOf === "string" ? item.asOf : null,
          points: Array.isArray(item.points) ? item.points.filter((point) => typeof point === "number") : []
        }))
        .filter((item) => item.code === "US2000" || item.code === "US100" || item.code === "US500");

      if (normalized.length > 0) {
        setIndicesYtd(normalized);
      }
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    try {
      const hasRealData = indicesYtd.some((item) => item.current !== null || item.points.length > 0);
      if (!hasRealData) return;
      window.localStorage.setItem(LOCAL_INDICES_STORAGE_KEY, JSON.stringify(indicesYtd));
    } catch {
      // no-op
    }
  }, [indicesYtd]);

  useEffect(() => {
    const handleVisibility = (): void => {
      setIsPageVisible(!document.hidden);
    };

    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(portfolioStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<{
        id?: string;
        symbol?: string;
        shares?: number;
        analysis?: PersistedAnalysis | null;
      }>;
      if (!Array.isArray(parsed)) return;

      const restored = parsed
        .map((item, index) => ({
          id: typeof item.id === "string" ? item.id : `restored-${index}`,
          symbol: typeof item.symbol === "string" ? item.symbol.toUpperCase() : "",
          shares: typeof item.shares === "number" && item.shares > 0 ? item.shares : 0,
          analysis: item.analysis ?? null,
          loading: false,
          error: null,
          expanded: false
        }))
        .filter((item) => item.symbol && item.shares > 0);

      if (restored.length > 0) {
        setPortfolioHoldings(restored);
      }
    } catch {
      // no-op
    }
  }, [portfolioStorageKey]);

  useEffect(() => {
    if (!currentUserId) {
      setPersistedPortfolioSnapshot(null);
      portfolioHydratedFromServerRef.current = false;
      return;
    }

    let cancelled = false;

    const loadSnapshot = async (): Promise<void> => {
      try {
        const response = await fetch("/api/portfolio?portfolioId=default", {
          method: "GET",
          cache: "no-store"
        });

        const payload = (await response.json()) as {
          snapshot?: PersistedPortfolioSnapshot | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load portfolio snapshot.");
        }

        if (cancelled) return;
        const snapshot = payload.snapshot ?? null;
        setPersistedPortfolioSnapshot(snapshot);
        let hasLocalPortfolioCache = false;
        try {
          hasLocalPortfolioCache = Boolean(window.localStorage.getItem(portfolioStorageKey));
        } catch {
          hasLocalPortfolioCache = false;
        }

        if (
          snapshot &&
          portfolioHoldings.length === 0 &&
          !hasLocalPortfolioCache &&
          !portfolioHydratedFromServerRef.current &&
          Array.isArray(snapshot.holdings) &&
          snapshot.holdings.length > 0
        ) {
          const restored: PortfolioHolding[] = snapshot.holdings
            .map((holding, index) => ({
              id: `server-${holding.symbol}-${index}`,
              symbol: holding.symbol.toUpperCase(),
              shares: Math.max(1, Math.floor(holding.shares)),
              analysis: null,
              loading: false,
              error: null,
              expanded: false
            }))
            .filter((holding) => Boolean(holding.symbol));

          if (restored.length > 0) {
            setPortfolioHoldings(restored);
            portfolioHydratedFromServerRef.current = true;
            for (const holding of restored) {
              void refreshPortfolioHolding(holding.symbol);
            }
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load portfolio snapshot.";
        console.warn(`[Stock Dashboard]: ${message}`);
      }
    };

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
    // Bootstrap-load once per authenticated identity; re-running on every holding mutation causes looped hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, portfolioStorageKey]);

  useEffect(() => {
    return () => {
      if (portfolioPersistTimeoutRef.current !== null) {
        window.clearTimeout(portfolioPersistTimeoutRef.current);
        portfolioPersistTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (currentUserId) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(localWatchlistStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as WatchlistItem[];
      if (!Array.isArray(parsed)) return;
      setWatchlist(parsed.filter((item): item is WatchlistItem => Boolean(item?.symbol)));
    } catch {
      // no-op
    }
  }, [currentUserId, localWatchlistStorageKey]);

  useEffect(() => {
    if (currentUserId) {
      return;
    }

    try {
      window.localStorage.setItem(localWatchlistStorageKey, JSON.stringify(watchlist));
    } catch {
      // no-op
    }
  }, [watchlist, currentUserId, localWatchlistStorageKey]);

  useEffect(() => {
    if (!currentUserId) return;
    console.log(`[Stock Dashboard]: Realtime status -> ${socketStatus}`);
    if (socketError) {
      console.warn(`[Stock Dashboard]: Realtime error -> ${socketError}`);
    }
  }, [currentUserId, socketStatus, socketError]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    let cancelled = false;

    const syncWatchlistFromServer = async (reason: string): Promise<void> => {
      try {
        const response = await fetch("/api/watchlist", {
          method: "GET",
          cache: "no-store"
        });
        const payload = (await response.json()) as {
          watchlist?: WatchlistItem[];
          error?: string;
        };

        if (!response.ok || !payload.watchlist) {
          const message = payload.error ?? "Failed to refresh watchlist from realtime sync.";
          throw new Error(message);
        }

        if (!cancelled) {
          setWatchlist(payload.watchlist);
          console.log(`[Stock Dashboard]: Watchlist synced (${reason})`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown realtime watchlist sync error.";
        if (!cancelled) {
          console.error(`[Stock Dashboard]: Realtime sync failed: ${message}`);
        }
      }
    };

    const handleWatchlistDelta = (payload: WatchlistDeltaPayload): void => {
      try {
        if (!payload || !currentUserId || payload.userId !== currentUserId) {
          return;
        }
        console.log(
          `[Stock Dashboard]: Realtime delta action=${payload.action} symbol=${payload.symbol} user=${payload.userId}`
        );
        void syncWatchlistFromServer("socket-delta");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed realtime payload.";
        console.error(`[Stock Dashboard]: Delta handler error: ${message}`);
      }
    };

    const handleMarketMoversDelta = (payload: MarketMoversPayload): void => {
      try {
        if (!payload || !Array.isArray(payload.movers)) return;
        setMarketMovers(payload.movers.slice(0, 3));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed movers realtime payload.";
        console.error(`[Stock Dashboard]: Movers delta error: ${message}`);
      }
    };

    const handleIndicesDelta = (payload: IndicesYtdPayload): void => {
      try {
        if (!payload || !Array.isArray(payload.indices)) return;
        setIndicesYtd((prev) => mergeIndexRows(payload.indices, prev, FALLBACK_INDICES_YTD));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed indices realtime payload.";
        console.error(`[Stock Dashboard]: Indices delta error: ${message}`);
      }
    };

    const handleEarningsDelta = (payload: EarningsPayload): void => {
      try {
        if (!payload || !Array.isArray(payload.upcoming)) return;
        setUpcomingEarnings(payload.upcoming);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed earnings realtime payload.";
        console.error(`[Stock Dashboard]: Earnings delta error: ${message}`);
      }
    };

    const handleMag7Delta = (payload: Mag7Payload): void => {
      try {
        if (!payload || !Array.isArray(payload.cards)) return;
        setMag7Cards(sortMag7Cards(payload.cards as Mag7ScoreCard[]));
        if (typeof payload.marketOpen === "boolean") {
          setIsMarketOpen(payload.marketOpen);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed MAG7 realtime payload.";
        console.error(`[Stock Dashboard]: MAG7 delta error: ${message}`);
      }
    };

    const handleQuoteTicksDelta = (payload: QuoteTicksPayload): void => {
      try {
        if (!payload || !Array.isArray(payload.updates) || payload.updates.length === 0) return;
        const bySymbol = new Map<string, { price: number; asOfMs: number }>();
        for (const row of payload.updates) {
          if (!row || typeof row.symbol !== "string") continue;
          if (typeof row.price !== "number" || !Number.isFinite(row.price) || row.price <= 0) continue;
          bySymbol.set(row.symbol.toUpperCase(), {
            price: row.price,
            asOfMs: typeof row.asOfMs === "number" && Number.isFinite(row.asOfMs) ? row.asOfMs : Date.now()
          });
        }
        if (bySymbol.size === 0) return;
        quoteTickLastSeenRef.current = Date.now();
        if (quoteFallbackActiveRef.current) {
          quoteFallbackActiveRef.current = false;
          console.info("[Stock Dashboard]: Realtime quote ticks resumed. HTTP fallback polling suspended.");
        }
        applyLiveQuoteMap(bySymbol);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed quote-ticks realtime payload.";
        console.error(`[Stock Dashboard]: Quote-ticks delta error: ${message}`);
      }
    };

    socket.on(SOCKET_EVENTS.WATCHLIST_UPDATED, handleWatchlistDelta);
    socket.on(SOCKET_EVENTS.MARKET_MOVERS_UPDATED, handleMarketMoversDelta);
    socket.on(SOCKET_EVENTS.INDICES_YTD_UPDATED, handleIndicesDelta);
    socket.on(SOCKET_EVENTS.EARNINGS_UPDATED, handleEarningsDelta);
    socket.on(SOCKET_EVENTS.MAG7_UPDATED, handleMag7Delta);
    socket.on(SOCKET_EVENTS.QUOTE_TICKS_UPDATED, handleQuoteTicksDelta);

    return () => {
      cancelled = true;
      socket.off(SOCKET_EVENTS.WATCHLIST_UPDATED, handleWatchlistDelta);
      socket.off(SOCKET_EVENTS.MARKET_MOVERS_UPDATED, handleMarketMoversDelta);
      socket.off(SOCKET_EVENTS.INDICES_YTD_UPDATED, handleIndicesDelta);
      socket.off(SOCKET_EVENTS.EARNINGS_UPDATED, handleEarningsDelta);
      socket.off(SOCKET_EVENTS.MAG7_UPDATED, handleMag7Delta);
      socket.off(SOCKET_EVENTS.QUOTE_TICKS_UPDATED, handleQuoteTicksDelta);
    };
  }, [socket, currentUserId, applyLiveQuoteMap]);

  useEffect(() => {
    if (!isAppOpen) return;

    let disposed = false;
    let timer: number | null = null;

    const pollQuotes = async (): Promise<void> => {
      if (disposed) return;
      if (!isPageVisible) return;
      if (quotePollInFlightRef.current) return;

      const symbols = quotePollSymbolsRef.current;
      if (symbols.length === 0) return;

      const now = Date.now();
      const disconnected = socketStatus !== "connected";
      const streamIdle = socketStatus === "connected" && (now - quoteTickLastSeenRef.current) >= QUOTE_STREAM_IDLE_THRESHOLD_MS;
      const shouldFallbackPoll = disconnected || streamIdle;

      if (!shouldFallbackPoll) {
        if (quoteFallbackActiveRef.current) {
          quoteFallbackActiveRef.current = false;
          console.info("[Stock Dashboard]: Realtime stream healthy. HTTP fallback polling paused.");
        }
        return;
      }

      if (now - quotePollLastRunRef.current < QUOTE_HTTP_POLL_INTERVAL_MS) {
        return;
      }

      quotePollInFlightRef.current = true;
      quotePollLastRunRef.current = now;
      if (!quoteFallbackActiveRef.current) {
        quoteFallbackActiveRef.current = true;
        const reason = disconnected
          ? `socket status=${socketStatus}`
          : `idle>${Math.round(QUOTE_STREAM_IDLE_THRESHOLD_MS / 1000)}s`;
        console.warn(`[Stock Dashboard]: Activating HTTP quote fallback polling (${reason}).`);
      }

      const controller = new AbortController();
      quotePollAbortRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), QUOTE_HTTP_POLL_TIMEOUT_MS);

      try {
        const params = new URLSearchParams({ symbols: symbols.join(",") });
        const response = await fetch(`/api/price/live?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as {
          quotes?: LiveQuotePollRow[];
        };
        if (!response.ok || !Array.isArray(payload.quotes)) return;

        const bySymbol = new Map<string, { price: number; asOfMs: number }>();
        for (const row of payload.quotes) {
          if (!row || typeof row.symbol !== "string") continue;
          if (typeof row.price !== "number" || !Number.isFinite(row.price) || row.price <= 0) continue;
          bySymbol.set(row.symbol.toUpperCase(), {
            price: row.price,
            asOfMs: typeof row.asOfMs === "number" && Number.isFinite(row.asOfMs) ? row.asOfMs : Date.now()
          });
        }

        if (bySymbol.size > 0) {
          applyLiveQuoteMap(bySymbol);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const message = error instanceof Error ? error.message : "Unknown quote fallback polling error.";
        console.warn(`[Stock Dashboard]: HTTP quote fallback poll failed: ${message}`);
      } finally {
        window.clearTimeout(timeoutId);
        if (quotePollAbortRef.current === controller) {
          quotePollAbortRef.current = null;
        }
        quotePollInFlightRef.current = false;
      }
    };

    timer = window.setInterval(() => {
      void pollQuotes();
    }, QUOTE_HTTP_POLL_TICK_MS);

    void pollQuotes();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
      if (quotePollAbortRef.current) {
        quotePollAbortRef.current.abort();
        quotePollAbortRef.current = null;
      }
      quotePollInFlightRef.current = false;
      quoteFallbackActiveRef.current = false;
    };
  }, [isAppOpen, isPageVisible, socketStatus, applyLiveQuoteMap]);

  useEffect(() => {
    try {
      const serializable = portfolioHoldings.map((item) => ({
        id: item.id,
        symbol: item.symbol,
        shares: item.shares,
        analysis: item.analysis
      }));
      window.localStorage.setItem(portfolioStorageKey, JSON.stringify(serializable));
    } catch {
      // no-op
    }
  }, [portfolioHoldings, portfolioStorageKey]);

  useEffect(() => {
    if (view !== "home") {
      setHomeHeaderVisible(true);
      return;
    }

    const onScroll = (): void => {
      const y = window.scrollY;
      const heroHeight = heroSectionRef.current?.offsetHeight ?? 420;
      const threshold = Math.max(220, Math.floor(heroHeight * 0.58));
      setHomeHeaderVisible(y > threshold);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [view]);

  useEffect(() => {
    if (!isAppOpen) return;

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".reveal-block"));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        }
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -6% 0px"
      }
    );

    for (const node of nodes) {
      observer.observe(node);
    }

    return () => observer.disconnect();
  }, [isAppOpen, view, currentRating, marketMovers.length, upcomingEarnings.length, watchlist.length]);

  useEffect(() => {
    if (view !== "results") {
      setIsNewsExpanded(false);
      setComparisonOpen(false);
      setShowAllJournalLinks(false);
    }
  }, [view, currentRating?.symbol]);

  useEffect(() => {
    if (view !== "home" && homeTickerDrawer) {
      setHomeTickerDrawer(null);
    }
  }, [homeTickerDrawer, view]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && shareModalOpen) {
        event.preventDefault();
        closeShareModal();
        return;
      }

      if (event.key === "Escape" && homeTickerDrawer) {
        event.preventDefault();
        setHomeTickerDrawer(null);
        return;
      }

      if (event.key === "Escape" && view === "portfolio" && portfolioDrawerHoldingId) {
        event.preventDefault();
        setPortfolioDrawerHoldingId(null);
        return;
      }

      if (event.key === "Escape") {
        if (showShortcuts) {
          event.preventDefault();
          setShowShortcuts(false);
          return;
        }
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === "?" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setShowShortcuts(true);
        return;
      }

      if (isPaletteOpenShortcut(event)) {
        event.preventDefault();
        setPaletteQuery(ticker);
        setPaletteError("");
        setPaletteAction("analyze");
        setIsProfileOpen(false);
        setIsCommandPaletteOpen(true);
        return;
      }

      if (event.key === "Escape" && isCommandPaletteOpen) {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (!event.ctrlKey && !event.metaKey) {
        if (event.key === "/") {
          event.preventDefault();
          openCommandPalette(ticker);
          return;
        }
        const lower = event.key.toLowerCase();
        if (lower === "s") {
          event.preventDefault();
          openCommandPalette(ticker);
          return;
        }
        if (lower === "p") {
          event.preventDefault();
          setView("portfolio");
          return;
        }
        if (lower === "j") {
          event.preventDefault();
          openJournalPage();
          return;
        }
      }

      if (event.key === "Escape" && isProfileOpen) {
        event.preventDefault();
        closeProfileModal();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isAppOpen,
    isCommandPaletteOpen,
    isProfileOpen,
    openCommandPalette,
    openJournalPage,
    showShortcuts,
    ticker,
    closeCommandPalette,
    closeProfileModal,
    shareModalOpen,
    closeShareModal,
    homeTickerDrawer,
    portfolioDrawerHoldingId,
    view
  ]);

  useEffect(() => {
    setMag7Cards(sortMag7Cards(initialMag7Scores));
  }, [initialMag7Scores]);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    const timeout = window.setTimeout(() => {
      paletteInputRef.current?.focus({ preventScroll: true });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;

    if (!isCommandPaletteOpen) {
      body.style.overflow = "";
      html.style.overflow = "";
      return;
    }

    body.style.overflow = "hidden";
    html.style.overflow = "hidden";

    return () => {
      body.style.overflow = "";
      html.style.overflow = "";
    };
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (!isAppOpen || !isPageVisible) {
      return;
    }

    function onMouseMove(event: MouseEvent): void {
      const now = performance.now();
      if (now - mouseLastPaintRef.current < 40) {
        return;
      }

      mouseLastPaintRef.current = now;
      mousePosRef.current = { x: event.clientX, y: event.clientY };
      if (mouseRafRef.current !== null) return;

      mouseRafRef.current = window.requestAnimationFrame(() => {
        const root = document.documentElement;
        root.style.setProperty("--mouse-x", `${mousePosRef.current.x}px`);
        root.style.setProperty("--mouse-y", `${mousePosRef.current.y}px`);
        mouseRafRef.current = null;
      });
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      if (mouseRafRef.current !== null) {
        window.cancelAnimationFrame(mouseRafRef.current);
        mouseRafRef.current = null;
      }
    };
  }, [isAppOpen, isPageVisible]);

  useEffect(() => {
    return () => {
      analysisAbortRef.current?.abort();
      if (watchlistHintTimeoutRef.current !== null) {
        window.clearTimeout(watchlistHintTimeoutRef.current);
        watchlistHintTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (analysisPhase !== "rendering") return;
    if (view !== "results" || !currentRating) return;

    let cancelled = false;
    let rafOne = 0;
    let rafTwo = 0;
    let timeoutId = 0;
    let idleId: number | null = null;

    const finalize = (): void => {
      if (cancelled) return;
      setAnalysisPhase("idle");
      setPendingSymbol(null);
    };

    rafOne = window.requestAnimationFrame(() => {
      rafTwo = window.requestAnimationFrame(() => {
        const withIdleCallback = window as Window & {
          requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
          cancelIdleCallback?: (id: number) => void;
        };

        if (typeof withIdleCallback.requestIdleCallback === "function") {
          idleId = withIdleCallback.requestIdleCallback(finalize, { timeout: 70 });
        } else {
          finalize();
        }
      });
    });

    timeoutId = window.setTimeout(finalize, 90);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafOne);
      window.cancelAnimationFrame(rafTwo);
      window.clearTimeout(timeoutId);
      const withIdleCallback = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleId !== null && typeof withIdleCallback.cancelIdleCallback === "function") {
        withIdleCallback.cancelIdleCallback(idleId);
      }
    };
  }, [analysisPhase, view, currentRating]);

  useEffect(() => {
    if (!isAppOpen) {
      return;
    }

    let disposed = false;
    let timer: number | null = null;

    const schedule = (delayMs: number): void => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      if (!isPageVisible) {
        schedule(180_000);
        return;
      }

      try {
        const response = await fetch("/api/mag7?live=1");
        const payload = (await response.json()) as {
          cards?: Mag7ScoreCard[];
          marketOpen?: boolean;
          error?: string;
        };

        if (!response.ok || !Array.isArray(payload.cards)) {
          schedule(30_000);
          return;
        }

        const nextCards = sortMag7Cards(payload.cards);
        setMag7Cards((prev) => {
          const frozenPercentCards = payload.marketOpen
            ? nextCards
            : nextCards.map((card) => {
                const previous = prev.find((item) => item.symbol === card.symbol);
                if (!previous || previous.changePercent === null) {
                  return card;
                }

                return {
                  ...card,
                  changePercent: previous.changePercent
                };
              });

          return areMag7CardsEqual(prev, frozenPercentCards) ? prev : frozenPercentCards;
        });

        const marketOpen = Boolean(payload.marketOpen);
        setIsMarketOpen(marketOpen);
        schedule(marketOpen ? 45_000 : 180_000);
      } catch {
        schedule(30_000);
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isAppOpen, isPageVisible]);

  useEffect(() => {
    if (!isAppOpen) return;

    let disposed = false;
    let timer: number | null = null;

    const schedule = (delayMs: number): void => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      if (disposed) return;
      if (!isPageVisible) {
        schedule(180_000);
        return;
      }
      if (marketMovers.length === 0) {
        setMarketMoversLoading(true);
      }
      try {
        const response = await fetch("/api/movers");
        const payload = (await response.json()) as { movers?: MarketMoverItem[] };
        if (response.ok && Array.isArray(payload.movers)) {
          setMarketMovers(payload.movers.slice(0, 3));
        }
      } finally {
        setMarketMoversLoading(false);
        schedule(isMarketOpen ? 60_000 : 240_000);
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isAppOpen, isMarketOpen, marketMovers.length, isPageVisible]);

  useEffect(() => {
    if (!isAppOpen) return;

    let disposed = false;
    let timer: number | null = null;

    const schedule = (delayMs: number): void => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        void loadEarnings(false);
      }, delayMs);
    };

    const loadEarnings = async (showSpinner: boolean): Promise<void> => {
      if (showSpinner) {
        setEarningsLoading(true);
      }
      setEarningsError("");

      try {
        const response = await fetch("/api/earnings");
        const payload = (await response.json()) as {
          upcoming?: UpcomingEarningsItem[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load earnings.");
        }

        if (disposed) return;
        const upcoming = Array.isArray(payload.upcoming) ? payload.upcoming : [];
        setUpcomingEarnings((prev) => (upcoming.length > 0 ? upcoming : prev));
        schedule(isPageVisible ? 60 * 60 * 1000 : 2 * 60 * 60 * 1000);
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : "Failed to load earnings.";
        setEarningsError(message);
        schedule(isPageVisible ? 30_000 : 5 * 60_000);
      } finally {
        if (!disposed) {
          setEarningsLoading(false);
        }
      }
    };

    void loadEarnings(isPageVisible);

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isAppOpen, isPageVisible]);

  useEffect(() => {
    if (!isAppOpen || view !== "home") return;

    let disposed = false;
    let timer: number | null = null;

    const schedule = (delayMs: number): void => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      if (!isPageVisible) {
        schedule(30 * 60 * 1000);
        return;
      }

      setIndicesError("");
      try {
        const response = await fetch("/api/indices/ytd");
        const payload = (await response.json()) as { indices?: IndexYtdItem[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load indices.");
        }

        const nextIndices = Array.isArray(payload.indices) ? payload.indices : [];
        if (nextIndices.length > 0) {
          setIndicesYtd((prev) => mergeIndexRows(nextIndices, prev, FALLBACK_INDICES_YTD));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load indices.";
        setIndicesError(message);
      } finally {
        schedule(isMarketOpen ? 5 * 60 * 1000 : 30 * 60 * 1000);
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isAppOpen, view, isMarketOpen, isPageVisible, indicesYtd.length]);

  useEffect(() => {
    if (isAppOpen) return;
    if (readCachedHomeDashboard("YTD")) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const controller = new AbortController();

    const prewarmDashboard = async (): Promise<void> => {
      try {
        const response = await fetch("/api/home/dashboard?sectorWindow=YTD", {
          signal: controller.signal
        });
        if (!response.ok) return;
        const payload = (await response.json()) as HomeDashboardPayload;
        if (cancelled) return;
        writeCachedHomeDashboard(payload);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    };

    const withIdleCallback = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof withIdleCallback.requestIdleCallback === "function") {
      idleId = withIdleCallback.requestIdleCallback(() => {
        void prewarmDashboard();
      }, { timeout: 180 });
    } else {
      timeoutId = window.setTimeout(() => {
        void prewarmDashboard();
      }, 160);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId !== null && typeof withIdleCallback.cancelIdleCallback === "function") {
        withIdleCallback.cancelIdleCallback(idleId);
      }
    };
  }, [isAppOpen]);

  useEffect(() => {
    if (!isAppOpen || view !== "home") return;

    let disposed = false;
    let timer: number | null = null;
    const controller = new AbortController();
    const cachedDashboard = readCachedHomeDashboard(sectorRotationWindow);

    if (cachedDashboard) {
      setHomeDashboard((current) => {
        if (!current) return cachedDashboard;
        if (current.sectorWindow !== sectorRotationWindow) return cachedDashboard;

        const currentTs = Date.parse(current.generatedAt);
        const cachedTs = Date.parse(cachedDashboard.generatedAt);
        if (Number.isFinite(currentTs) && Number.isFinite(cachedTs) && currentTs >= cachedTs) {
          return current;
        }
        return cachedDashboard;
      });
      homeDashboardLoadedRef.current = true;
    }

    const schedule = (delayMs: number): void => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        void loadDashboard(false);
      }, delayMs);
    };

    const loadDashboard = async (showSkeleton: boolean): Promise<void> => {
      let keepLoading = false;
      if (showSkeleton) {
        setHomeDashboardLoading(true);
      }
      setHomeDashboardError("");

      try {
        const params = new URLSearchParams({ sectorWindow: sectorRotationWindow });
        const response = await fetch(`/api/home/dashboard?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = (await response.json()) as HomeDashboardPayload & {
          error?: string;
          pending?: boolean;
          refreshQueued?: boolean;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load dashboard modules.");
        }
        if (disposed) return;
        if (payload.pending) {
          if (!homeDashboardLoadedRef.current && !cachedDashboard) {
            keepLoading = true;
            setHomeDashboardLoading(true);
          }
          schedule(2_500);
          return;
        }
        setHomeDashboard(payload);
        writeCachedHomeDashboard(payload);
        homeDashboardLoadedRef.current = true;
        schedule(isMarketOpen ? 75_000 : 180_000);
      } catch (error) {
        if (disposed) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "Failed to load dashboard modules.";
        setHomeDashboardError(message);
        schedule(45_000);
      } finally {
        if (!disposed && !keepLoading) {
          setHomeDashboardLoading(false);
        }
      }
    };

    void loadDashboard(!homeDashboardLoadedRef.current && !cachedDashboard);

    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isAppOpen, view, isMarketOpen, sectorRotationWindow]);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    const query = deferredPaletteQuery.trim();
    if (!query) {
      setPaletteResults([]);
      setPaletteLoading(false);
      setPaletteError("");
      setPaletteSelectionIndex(0);
      return;
    }

    const queryKey = query.toUpperCase();
    const cachedResults = paletteCacheRef.current.get(queryKey);
    if (cachedResults) {
      setPaletteResults(cachedResults);
      setPaletteLoading(false);
      setPaletteError("");
      setPaletteSelectionIndex(0);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPaletteLoading(true);
      setPaletteError("");

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${COMMAND_PALETTE_LIMIT}`, {
          signal: controller.signal
        });
        const payload = (await response.json()) as { results?: SearchResultItem[]; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Search failed.");
        }

        const results = Array.isArray(payload.results) ? payload.results : [];
        const deduped = dedupeSearchResultsBySymbol(results);
        if (paletteCacheRef.current.size > 220) {
          paletteCacheRef.current.clear();
        }
        paletteCacheRef.current.set(queryKey, deduped);
        setPaletteResults(deduped);
        setPaletteSelectionIndex(0);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        const message = error instanceof Error ? error.message : "Search failed.";
        setPaletteResults([]);
        setPaletteError(message);
      } finally {
        setPaletteLoading(false);
      }
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [isCommandPaletteOpen, deferredPaletteQuery]);

  useEffect(() => {
    if (view !== "results" || !currentRating) {
      setStockContext(null);
      setStockContextError("");
      setStockContextLoading(false);
      setResultsContextReady(true);
      return;
    }

    const ratingSnapshot = currentRating;
    let disposed = false;
    let timer: number | null = null;
    let firstRun = true;
    let inFlight = false;

    const schedule = (delayMs: number): void => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        void loadStockContext();
      }, delayMs);
    };

    async function loadStockContext(): Promise<void> {
      if (disposed || inFlight) return;
      inFlight = true;

      if (firstRun) {
        setStockContextLoading(true);
      }
      setStockContextError("");

      try {
        const response = await fetch(
          `/api/context?symbol=${encodeURIComponent(ratingSnapshot.symbol)}&score=${encodeURIComponent(
            ratingSnapshot.score.toString()
          )}&live=1`
        );

        const payload = (await response.json()) as StockContextData & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load sector context.");
        }

        setStockContext(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load sector context.";
        setStockContext(null);
        setStockContextError(message);
      } finally {
        if (firstRun) {
          setResultsContextReady(true);
        }
        firstRun = false;
        inFlight = false;
        setStockContextLoading(false);
        schedule(isMarketOpen ? 45_000 : 120_000);
      }
    }

    void loadStockContext();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [view, currentRating, isMarketOpen]);

  useEffect(() => {
    if (view !== "results" || !currentRating) {
      setPriceHistory([]);
      setPriceHistoryChangePercent(null);
      setPriceHistoryLoading(false);
      setPriceHistoryError("");
      return;
    }

    const cacheKey = `${currentRating.symbol}:${priceRange}`;
    const cached = priceHistoryCacheRef.current.get(cacheKey);
    if (cached) {
      setPriceHistory(cached.points);
      setPriceHistoryChangePercent(cached.changePercent);
      setPriceHistoryLoading(false);
      setPriceHistoryError("");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      setPriceHistoryLoading(true);
      setPriceHistoryError("");

      try {
        const response = await fetch(
          `/api/price/history?symbol=${encodeURIComponent(currentRating.symbol)}&range=${priceRange}`,
          { signal: controller.signal, cache: "no-store" }
        );
        const payload = (await response.json()) as {
          points?: PriceHistoryPoint[];
          changePercent?: number | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load price history.");
        }

        const points = Array.isArray(payload.points) ? payload.points : [];
        const changePercent = typeof payload.changePercent === "number" ? payload.changePercent : null;

        if (cancelled) return;
        priceHistoryCacheRef.current.set(cacheKey, { points, changePercent });
        setPriceHistory(points);
        setPriceHistoryChangePercent(changePercent);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load price history.";
        setPriceHistory([]);
        setPriceHistoryChangePercent(null);
        setPriceHistoryError(message);
      } finally {
        if (!cancelled) {
          setPriceHistoryLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [view, currentRating, priceRange]);

  useEffect(() => {
    if (view !== "results" || !currentRating || !currentUserId) {
      setJournalRelatedEntries([]);
      setJournalRelatedError("");
      setJournalRelatedLoading(false);
      return;
    }

    let cancelled = false;

    const loadJournalEntries = async (): Promise<void> => {
      setJournalRelatedLoading(true);
      setJournalRelatedError("");
      try {
        const response = await fetch(
          `/api/journal/entries?symbol=${encodeURIComponent(currentRating.symbol)}&limit=10`,
          { method: "GET", cache: "no-store" }
        );
        const payload = (await response.json()) as {
          items?: Array<{
            id: string;
            ticker: string;
            thesis: string;
            status: "PLANNING" | "OPEN" | "CLOSED";
            createdAt: string;
          }>;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load journal links.");
        }
        if (cancelled) return;
        setJournalRelatedEntries(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        if (cancelled) return;
        setJournalRelatedEntries([]);
        setJournalRelatedError(error instanceof Error ? error.message : "Failed to load journal links.");
      } finally {
        if (!cancelled) {
          setJournalRelatedLoading(false);
        }
      }
    };

    void loadJournalEntries();

    return () => {
      cancelled = true;
    };
  }, [currentRating, currentUserId, view]);

  useEffect(() => {
    if (!currentRating || view !== "results") {
      return;
    }

    setComparisonStateBySymbol((prev) => ({
      ...prev,
      [currentRating.symbol]: {
        analysis: currentRating,
        loading: false,
        error: null
      }
    }));

    if (comparisonOpen) {
      setComparisonSymbols((prev) => {
        if (prev.length === 0) {
          return [currentRating.symbol];
        }
        if (prev[0] === currentRating.symbol) {
          return prev;
        }
        const deduped = [currentRating.symbol, ...prev.filter((symbol) => symbol !== currentRating.symbol)];
        return deduped.slice(0, 3);
      });
    }
  }, [currentRating, view, comparisonOpen]);

  function cacheAnalysisResult(analysis: PersistedAnalysis): void {
    analysisCacheRef.current.set(analysis.symbol, {
      analysis,
      expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS
    });

    if (analysisCacheRef.current.size > 40) {
      const oldest = analysisCacheRef.current.keys().next().value;
      if (oldest) {
        analysisCacheRef.current.delete(oldest);
      }
    }
  }

  async function fetchAnalysisSnapshot(
    rawSymbol: string,
    options?: {
      signal?: AbortSignal;
      bypassCache?: boolean;
    }
  ): Promise<PersistedAnalysis> {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol) {
      throw new Error("Ticker symbol is invalid.");
    }

    if (!options?.bypassCache) {
      const cachedEntry = analysisCacheRef.current.get(symbol);
      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        return cachedEntry.analysis;
      }
    }

    const response = await fetch("/api/rate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ symbol }),
      signal: options?.signal,
      cache: "no-store"
    });

    const payload = (await response.json()) as {
      analysis?: PersistedAnalysis;
      error?: string;
    };

    if (!response.ok || !payload.analysis) {
      throw new Error(payload.error ?? "Rating request failed.");
    }

    cacheAnalysisResult(payload.analysis);
    return payload.analysis;
  }

  async function addPortfolioHolding(rawSymbol?: string, rawShares?: number): Promise<void> {
    const symbol = (rawSymbol ?? portfolioInputTicker).trim().toUpperCase();
    const sharesValue = rawShares ?? Number.parseFloat(portfolioInputShares);
    const shares = Number.isFinite(sharesValue) ? Math.max(0, Math.floor(sharesValue)) : 0;

    if (!symbol) {
      setPortfolioError("Enter a ticker symbol.");
      return;
    }

    if (!shares || shares < 1) {
      setPortfolioError("Shares must be at least 1.");
      return;
    }

    setPortfolioLoading(true);
    setPortfolioError("");

    const rowId = `${symbol}-${Date.now()}`;
    setPortfolioHoldings((prev) => {
      const existing = prev.find((item) => item.symbol === symbol);
      if (existing) {
        return prev.map((item) =>
          item.symbol === symbol
            ? {
                ...item,
                shares: item.shares + shares,
                loading: true,
                error: null
              }
            : item
        );
      }

      return [
        {
          id: rowId,
          symbol,
          shares,
          analysis: null,
          loading: true,
          error: null,
          expanded: false
        },
        ...prev
      ];
    });

    try {
      const analysis = await fetchAnalysisSnapshot(symbol);
      setPortfolioHoldings((prev) =>
        prev.map((item) =>
          item.symbol === symbol
            ? {
                ...item,
                analysis,
                loading: false,
                error: null
              }
            : item
        )
      );
      setPortfolioInputTicker("");
      setPortfolioInputShares("1");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add holding.";
      setPortfolioError(message);
      setPortfolioHoldings((prev) =>
        prev.map((item) =>
          item.symbol === symbol
            ? {
                ...item,
                loading: false,
                error: message
              }
            : item
        )
      );
    } finally {
      setPortfolioLoading(false);
    }
  }

  function removePortfolioHolding(id: string): void {
    setPortfolioHoldings((prev) => prev.filter((item) => item.id !== id));
  }

  async function refreshPortfolioHolding(symbol: string): Promise<void> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;

    setPortfolioHoldings((prev) =>
      prev.map((item) =>
        item.symbol === normalized
          ? {
              ...item,
              loading: true,
              error: null
            }
          : item
      )
    );

    try {
      const analysis = await fetchAnalysisSnapshot(normalized, { bypassCache: true });
      setPortfolioHoldings((prev) =>
        prev.map((item) =>
          item.symbol === normalized
            ? {
                ...item,
                loading: false,
                error: null,
                analysis
              }
            : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed.";
      setPortfolioHoldings((prev) =>
        prev.map((item) =>
          item.symbol === normalized
            ? {
                ...item,
                loading: false,
                error: message
              }
            : item
        )
      );
    }
  }

  async function addComparisonSymbol(rawSymbol: string): Promise<void> {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol) return;
    setComparisonOpen(true);
    setComparisonSymbols((prev) => {
      const base = currentRating ? [currentRating.symbol] : [];
      const ordered = [...base, ...prev.filter((item) => item !== base[0])].filter((item, index, array) => array.indexOf(item) === index);
      if (!ordered.includes(symbol)) {
        if (ordered.length >= 3) {
          ordered[ordered.length - 1] = symbol;
        } else {
          ordered.push(symbol);
        }
      }
      return ordered.slice(0, 3);
    });

    if (currentRating && symbol === currentRating.symbol) {
      setComparisonStateBySymbol((prev) => ({
        ...prev,
        [symbol]: {
          analysis: currentRating,
          loading: false,
          error: null
        }
      }));
      return;
    }

    setComparisonStateBySymbol((prev) => ({
      ...prev,
      [symbol]: {
        analysis: prev[symbol]?.analysis ?? null,
        loading: true,
        error: null
      }
    }));

    try {
      const analysis = await fetchAnalysisSnapshot(symbol);
      setComparisonStateBySymbol((prev) => ({
        ...prev,
        [symbol]: {
          analysis,
          loading: false,
          error: null
        }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Comparison failed.";
      setComparisonStateBySymbol((prev) => ({
        ...prev,
        [symbol]: {
          analysis: prev[symbol]?.analysis ?? null,
          loading: false,
          error: message
        }
      }));
    }
  }

  async function analyzeSymbol(rawSymbol?: string): Promise<void> {
    const symbol = (rawSymbol ?? ticker).trim().toUpperCase();

    if (!symbol) {
      setApiError("Enter a ticker symbol first.");
      return;
    }

    const requestId = analysisRequestRef.current + 1;
    analysisRequestRef.current = requestId;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;

    setPendingSymbol(symbol);
    setLoading(true);
    setAnalysisPhase("fetching");
    setResultsContextReady(true);
    setApiError("");
    setHomeTickerDrawer(null);
    setView("results");

    let movedToRendering = false;

    try {
      const analysis = await fetchAnalysisSnapshot(symbol, { signal: controller.signal });

      if (requestId !== analysisRequestRef.current) {
        return;
      }

      setCurrentRating(analysis);
      setTicker(analysis.symbol);

      setHistory((prev) => {
        const deduped = [analysis, ...prev.filter((item) => item.id !== analysis.id)];
        return deduped.slice(0, 30);
      });
      setAnalysisPhase("rendering");
      movedToRendering = true;
    } catch (error) {
      if (requestId !== analysisRequestRef.current) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message = error instanceof Error ? error.message : "Unexpected API error.";
      setApiError(message);
    } finally {
      if (requestId !== analysisRequestRef.current) {
        return;
      }
      setLoading(false);
      if (!movedToRendering) {
        setAnalysisPhase("idle");
        setResultsContextReady(true);
        setPendingSymbol(null);
      }
    }
  }

  analyzeSymbolRef.current = analyzeSymbol;

  async function addWatchlistSymbolDirect(rawSymbol: string): Promise<void> {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol) return;

    if (currentUserId) {
      try {
        const response = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol })
        });
        const payload = (await response.json()) as { watchlist?: WatchlistItem[]; error?: string };
        if (!response.ok || !payload.watchlist) {
          throw new Error(payload.error ?? "Failed to add symbol.");
        }
        setWatchlist(payload.watchlist);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to add symbol.";
        setApiError(message);
        return;
      }
    } else {
      setWatchlist((prev) => {
        if (prev.some((item) => item.symbol === symbol)) return prev;
        return [{ symbol, createdAt: new Date().toISOString() }, ...prev];
      });
    }

    setWatchlistAddedSymbol(symbol);
    if (watchlistHintTimeoutRef.current !== null) {
      window.clearTimeout(watchlistHintTimeoutRef.current);
    }
    watchlistHintTimeoutRef.current = window.setTimeout(() => {
      setWatchlistAddedSymbol((prev) => (prev === symbol ? null : prev));
    }, 1800);
    setView("watchlist");
  }

  function selectSearchItem(item: SearchResultItem): void {
    setTicker(item.symbol);

    if (paletteAction === "portfolio-add") {
      closeCommandPalette();
      setPortfolioInputTicker(item.symbol);
      return;
    }

    if (paletteAction === "compare-add") {
      closeCommandPalette();
      void addComparisonSymbol(item.symbol);
      return;
    }

    if (paletteAction === "watchlist-add") {
      closeCommandPalette();
      void addWatchlistSymbolDirect(item.symbol);
      return;
    }

    closeCommandPalette();
    void analyzeSymbol(item.symbol);
  }

  async function saveToWatchlist(): Promise<void> {
    if (!currentRating) return;

    const saveLocalWatchlist = (): void => {
      setWatchlist((prev) => {
        const exists = prev.find((item) => item.symbol === currentRating.symbol);
        if (exists) {
          return prev.map((item) =>
            item.symbol === currentRating.symbol
              ? {
                  ...item,
                  latest: currentRating
                }
              : item
          );
        }
        return [
          {
            symbol: currentRating.symbol,
            createdAt: new Date().toISOString(),
            latest: currentRating
          },
          ...prev
        ];
      });
      setWatchlistAddedSymbol(currentRating.symbol);
      if (watchlistHintTimeoutRef.current !== null) {
        window.clearTimeout(watchlistHintTimeoutRef.current);
      }
      watchlistHintTimeoutRef.current = window.setTimeout(() => {
        setWatchlistAddedSymbol(null);
      }, 1800);
    };

    if (!currentUserId) {
      saveLocalWatchlist();
      return;
    }

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ symbol: currentRating.symbol })
      });

      if (response.status === 401) {
        saveLocalWatchlist();
        return;
      }

      const payload = (await response.json()) as {
        watchlist?: WatchlistItem[];
        error?: string;
      };

      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error ?? "Failed to save watchlist item.");
      }

      setWatchlist(payload.watchlist);
      setWatchlistAddedSymbol(currentRating.symbol);
      if (watchlistHintTimeoutRef.current !== null) {
        window.clearTimeout(watchlistHintTimeoutRef.current);
      }
      watchlistHintTimeoutRef.current = window.setTimeout(() => {
        setWatchlistAddedSymbol(null);
      }, 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Watchlist request failed.";
      setApiError(message);
    }
  }

  async function removeWatchlistSymbol(symbol: string): Promise<void> {
    const removeLocalWatchlist = (): void => {
      setWatchlist((prev) => prev.filter((item) => item.symbol !== symbol));
      if (watchlistHintTimeoutRef.current !== null) {
        window.clearTimeout(watchlistHintTimeoutRef.current);
        watchlistHintTimeoutRef.current = null;
      }
      setWatchlistAddedSymbol((prev) => (prev === symbol ? null : prev));
    };

    if (!currentUserId) {
      removeLocalWatchlist();
      return;
    }

    try {
      const response = await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        removeLocalWatchlist();
        return;
      }

      const payload = (await response.json()) as {
        watchlist?: WatchlistItem[];
        error?: string;
      };

      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error ?? "Failed to remove symbol.");
      }

      setWatchlist(payload.watchlist);
      if (watchlistHintTimeoutRef.current !== null) {
        window.clearTimeout(watchlistHintTimeoutRef.current);
        watchlistHintTimeoutRef.current = null;
      }
      setWatchlistAddedSymbol((prev) => (prev === symbol ? null : prev));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Watchlist request failed.";
      setApiError(message);
    }
  }

  const ratingContextSummary = useMemo(() => {
    if (!currentRating) {
      return {
        topPercentile: null as number | null,
        sectorAverageScore: null as number | null,
        keySignals: [] as Array<{ tone: "positive" | "risk"; text: string }>,
        topDrivers: [] as string[]
      };
    }

    const scoreSamples = history
      .map((item) => item.score)
      .filter((score) => Number.isFinite(score));

    scoreSamples.push(currentRating.score);
    const sortedScores = [...scoreSamples].sort((a, b) => b - a);
    const rankIndex = Math.max(0, sortedScores.findIndex((score) => currentRating.score >= score - 0.001));
    const topPercentile = sortedScores.length > 0
      ? Math.max(1, Math.round(((rankIndex + 1) / sortedScores.length) * 100))
      : null;

    const sectorAverageScore =
      typeof stockContext?.sectorAverageScore === "number" ? stockContext.sectorAverageScore : null;

    const totals = currentRating.factors.reduce<Record<string, number>>((acc, factorItem) => {
      acc[factorItem.category] = (acc[factorItem.category] ?? 0) + factorItem.points;
      return acc;
    }, {});

    const fundamentalsScore = (totals.Fundamental ?? 0) + (totals.Valuation ?? 0);
    const momentumScore = (totals.Technical ?? 0) + (totals.Momentum ?? 0) + (totals.Seasonality ?? 0);
    const sentimentScore = (totals.Sentiment ?? 0) + (totals.Macro ?? 0) + (totals.Options ?? 0);

    const keySignals: Array<{ tone: "positive" | "risk"; text: string }> = [];

    if (fundamentalsScore >= 1.2) {
      keySignals.push({ tone: "positive", text: "Strong fundamentals" });
    } else if (fundamentalsScore <= 0.45) {
      keySignals.push({ tone: "risk", text: "Premium valuation pressure" });
    }

    if (momentumScore >= 1.2) {
      keySignals.push({ tone: "positive", text: "Positive sector momentum" });
    } else if (momentumScore <= 0.4) {
      keySignals.push({ tone: "risk", text: "Weak technical momentum" });
    }

    if (sentimentScore >= 0.8) {
      keySignals.push({ tone: "positive", text: "Constructive macro and sentiment backdrop" });
    } else if (sentimentScore <= 0.2) {
      keySignals.push({ tone: "risk", text: "Risk sentiment remains fragile" });
    }

    if (keySignals.length === 0) {
      keySignals.push({ tone: "positive", text: "Balanced multi-factor setup" });
    }

    const topDrivers = [...currentRating.factors]
      .filter((factor) => factor.hasData)
      .sort((left, right) => Math.abs(right.points) - Math.abs(left.points))
      .map((factor) => `${factor.factor}: ${factor.ruleMatched}`)
      .slice(0, 10);

    return {
      topPercentile,
      sectorAverageScore,
      keySignals: keySignals.slice(0, 10),
      topDrivers
    };
  }, [currentRating, history, stockContext?.sectorAverageScore]);

  const fundamentalsSnapshot = useMemo(() => {
    if (!currentRating) {
      return {
        primaryValuation: {
          label: "P/E (NTM)",
          value: null as number | null,
          signal: null as FactorResult["signal"] | null,
          format: "multiple" as "multiple" | "percent",
          isFallback: false
        },
        revenueGrowth: {
          label: "Rev. Growth (YoY)",
          value: null as number | null,
          signal: null as FactorResult["signal"] | null,
          isFallback: false
        },
        epsGrowth: {
          label: "EPS Growth (YoY)",
          value: null as number | null,
          signal: null as FactorResult["signal"] | null,
          isFallback: false
        },
        fcfYield: {
          label: "FCF Yield",
          value: null as number | null,
          signal: null as FactorResult["signal"] | null,
          isFallback: false
        }
      };
    }

    const fundamentals = currentRating.fundamentals;
    const hasForwardPE = typeof fundamentals?.forwardPE === "number" && Number.isFinite(fundamentals.forwardPE);
    const hasTrailingPE = typeof fundamentals?.trailingPE === "number" && Number.isFinite(fundamentals.trailingPE);
    const inferredPeLabel = hasForwardPE ? "P/E (NTM)" : hasTrailingPE ? "P/E (TTM)" : "P/E";
    const peLabelByBasis =
      fundamentals?.peBasis === "NTM"
        ? "P/E (NTM)"
        : fundamentals?.peBasis === "TTM"
          ? "P/E (TTM)"
          : inferredPeLabel;
    const epsGrowthLabelByBasis =
      fundamentals?.epsGrowthBasis === "YOY"
        ? "EPS Growth (YoY)"
        : fundamentals?.epsGrowthBasis === "QOQ"
          ? "EPS Growth (QoQ)"
          : fundamentals?.epsGrowthBasis === "FORWARD_DELTA"
            ? "EPS Growth (Forward delta)"
            : "EPS Growth";
    const isReitValuation =
      currentRating.sector === "Real Estate" &&
      ((typeof fundamentals?.ffoYield === "number" && Number.isFinite(fundamentals.ffoYield)) ||
        findFactorMetric(currentRating.factors, "FFO Yield (REIT)") !== null);
    const directPeValueFromBasis =
      fundamentals?.peBasis === "NTM"
        ? fundamentals?.forwardPE ?? null
        : fundamentals?.peBasis === "TTM"
          ? fundamentals?.trailingPE ?? null
          : null;
    const directPeValue =
      directPeValueFromBasis ??
      (hasForwardPE ? fundamentals?.forwardPE ?? null : null) ??
      (hasTrailingPE ? fundamentals?.trailingPE ?? null : null);
    const fallbackPeValue = findFactorMetric(currentRating.factors, "P/E vs Sector");
    const primaryPeValue = directPeValue ?? fallbackPeValue;
    const primaryPeIsFallback = directPeValue === null && fallbackPeValue !== null;

    const directFfoYield = ratioToPercentPoints(fundamentals?.ffoYield ?? null);
    const fallbackFfoYield = findFactorMetric(currentRating.factors, "FFO Yield (REIT)");
    const resolvedFfoYield = directFfoYield ?? fallbackFfoYield;
    const ffoIsFallback = directFfoYield === null && fallbackFfoYield !== null;

    const directRevenueGrowth = ratioToPercentPoints(fundamentals?.revenueGrowth ?? null);
    const fallbackRevenueGrowth = findFactorMetric(currentRating.factors, "Revenue Growth");
    const resolvedRevenueGrowth = directRevenueGrowth ?? fallbackRevenueGrowth;
    const revenueGrowthIsFallback = directRevenueGrowth === null && fallbackRevenueGrowth !== null;

    const directEpsGrowth = ratioToPercentPoints(fundamentals?.earningsQuarterlyGrowth ?? null);
    const fallbackEpsGrowth = findFactorMetric(currentRating.factors, "EPS Growth");
    const resolvedEpsGrowth = directEpsGrowth ?? fallbackEpsGrowth;
    const epsGrowthIsFallback = directEpsGrowth === null && fallbackEpsGrowth !== null;

    const directFcfYield = ratioToPercentPoints(fundamentals?.fcfYield ?? null);
    const fallbackFcfYield = findFactorMetric(currentRating.factors, "FCF Yield");
    const resolvedFcfYield = directFcfYield ?? fallbackFcfYield;
    const fcfYieldIsFallback = directFcfYield === null && fallbackFcfYield !== null;

    return {
      primaryValuation: {
        label: isReitValuation ? "FFO Yield" : peLabelByBasis,
        value: isReitValuation
          ? resolvedFfoYield
          : primaryPeValue,
        signal: isReitValuation
          ? findFactorSignal(currentRating.factors, "FFO Yield (REIT)")
          : findFactorSignal(currentRating.factors, "P/E vs Sector"),
        format: isReitValuation ? ("percent" as const) : ("multiple" as const),
        isFallback: isReitValuation ? ffoIsFallback : primaryPeIsFallback
      },
      revenueGrowth: {
        label: "Rev. Growth (YoY)",
        value: resolvedRevenueGrowth,
        signal: findFactorSignal(currentRating.factors, "Revenue Growth"),
        isFallback: revenueGrowthIsFallback
      },
      epsGrowth: {
        label: epsGrowthLabelByBasis,
        value: resolvedEpsGrowth,
        signal: findFactorSignal(currentRating.factors, "EPS Growth"),
        isFallback: epsGrowthIsFallback
      },
      fcfYield: {
        label: "FCF Yield",
        value: resolvedFcfYield,
        signal: findFactorSignal(currentRating.factors, "FCF Yield"),
        isFallback: fcfYieldIsFallback
      }
    };
  }, [currentRating]);

  const scoreHistorySeries = useMemo(() => {
    if (!currentRating) {
      return [{ score: 0, createdAt: new Date().toISOString() }];
    }

    const symbolRows = history
      .filter((item) => item.symbol === currentRating.symbol)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const fromHistory = symbolRows
      .filter((item) => Number.isFinite(item.score))
      .map((item) => ({ score: item.score, createdAt: item.createdAt }));

    if (fromHistory.length >= 2) {
      return fromHistory.slice(-30);
    }

    return [
      { score: Math.max(0, currentRating.score - 0.4), createdAt: currentRating.createdAt },
      { score: currentRating.score, createdAt: currentRating.createdAt }
    ];
  }, [currentRating, history]);

  const scoreHistoryPoints = useMemo(() => scoreHistorySeries.map((row) => row.score), [scoreHistorySeries]);

  const priceChartOverlay = useMemo(() => {
    if (priceHistory.length < 2 || !currentRating) return null;

    const values = priceHistory.map((row) => row.price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 0.000001);
    const activeIndex = Math.max(0, Math.min(priceHistory.length - 1, priceChartHoverIndex ?? priceHistory.length - 1));
    const active = priceHistory[activeIndex];
    const x = (activeIndex / (priceHistory.length - 1)) * 720;
    const y = 220 - ((active.price - min) / span) * 220;

    return {
      index: activeIndex,
      x,
      y,
      xLabel: formatChartDate(active.time),
      yLabel: formatPrice(active.price, currentRating.currency),
      min,
      max
    };
  }, [currentRating, priceChartHoverIndex, priceHistory]);

  const scoreChartOverlay = useMemo(() => {
    if (scoreHistorySeries.length < 2) return null;

    const values = scoreHistorySeries.map((row) => row.score);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 0.000001);
    const activeIndex = Math.max(0, Math.min(scoreHistorySeries.length - 1, scoreChartHoverIndex ?? scoreHistorySeries.length - 1));
    const active = scoreHistorySeries[activeIndex];
    const x = (activeIndex / (scoreHistorySeries.length - 1)) * 320;
    const y = 60 - ((active.score - min) / span) * 60;

    return {
      index: activeIndex,
      x,
      y,
      xLabel: formatChartDate(active.createdAt),
      yLabel: active.score.toFixed(2)
    };
  }, [scoreChartHoverIndex, scoreHistorySeries]);

  const upgradePath = useMemo(() => {
    if (!currentRating) {
      return {
        targetLabel: null as string | null,
        actions: [] as string[]
      };
    }

    const order: RatingLabel[] = ["STRONG_SELL", "SELL", "HOLD", "BUY", "STRONG_BUY"];
    const currentIndex = Math.max(0, order.indexOf(currentRating.rating));
    const target = currentIndex < order.length - 1 ? order[currentIndex + 1] : null;
    const targetBand = target ? RATING_BANDS[target] : null;

    const weakestFactors = [...currentRating.factors]
      .filter((factor) => factor.hasData)
      .sort((left, right) => left.points - right.points)
      .slice(0, 3)
      .map((factor) => factorActionHint(factor.factor));

    return {
      targetLabel: targetBand?.label ?? null,
      actions: weakestFactors
    };
  }, [currentRating]);

  useEffect(() => {
    if (!currentRating?.symbol) return;
    pushRecentTicker(currentRating.symbol);
  }, [currentRating?.symbol]);

  useEffect(() => {
    setPriceChartHoverIndex(priceHistory.length > 0 ? priceHistory.length - 1 : null);
  }, [priceHistory]);

  useEffect(() => {
    setScoreChartHoverIndex(scoreHistorySeries.length > 0 ? scoreHistorySeries.length - 1 : null);
  }, [scoreHistorySeries]);

  const sectorRelative = useMemo(
    () => sectorRelativeState(stockContext?.vsSectorPercent ?? null),
    [stockContext?.vsSectorPercent]
  );
  const relatedNewsItems = useMemo(() => {
    const directNews = stockContext?.news ?? [];
    if (directNews.length > 0) {
      return directNews.slice(0, 4);
    }

    const sectorName = stockContext?.sector ?? currentRating?.sector ?? "market";
    const query = encodeURIComponent(`${sectorName} sector stocks`);

    return [
      {
        headline: `${sectorName} sector headlines`,
        url: `https://news.google.com/search?q=${query}`,
        source: "Google News",
        publishedAt: null
      }
    ];
  }, [stockContext?.news, stockContext?.sector, currentRating?.sector]);
  const fundamentalsNumbersLoading = loading || analysisPhase !== "idle" || !currentRating;
  const fundamentalsHackTrigger = useMemo(
    () => `${currentRating?.symbol ?? "none"}:${currentRating?.createdAt ?? "na"}:${currentRating?.score ?? "na"}`,
    [currentRating]
  );

  const portfolioAllocation = useMemo(() => {
    const completed = portfolioHoldings
      .filter((holding) => holding.analysis !== null)
      .map((holding) => {
        const analysis = holding.analysis as PersistedAnalysis;
        const positionValue = holding.shares * Math.max(analysis.currentPrice, 0.01);
        return {
          id: holding.id,
          symbol: holding.symbol,
          shares: holding.shares,
          price: analysis.currentPrice,
          positionValue
        };
      });

    const totalValue = completed.reduce((sum, item) => sum + item.positionValue, 0);
    const fallbackTotalShares = completed.reduce((sum, item) => sum + item.shares, 0);
    const denominator = totalValue > 0 ? totalValue : Math.max(fallbackTotalShares, 1);

    return completed.map((item) => {
      const numerator = totalValue > 0 ? item.positionValue : item.shares;
      return {
        ...item,
        allocationPct: (numerator / denominator) * 100
      };
    });
  }, [portfolioHoldings]);

  const portfolioAllocationById = useMemo(() => {
    const map = new Map<string, (typeof portfolioAllocation)[number]>();
    for (const item of portfolioAllocation) {
      map.set(item.id, item);
    }
    return map;
  }, [portfolioAllocation]);

  const portfolioAggregatorRows = useMemo(() => {
    return portfolioHoldings
      .map((holding) => {
        const analysis = holding.analysis;
        const allocation = portfolioAllocationById.get(holding.id);
        const positionValue =
          allocation?.positionValue ??
          (analysis ? holding.shares * Math.max(analysis.currentPrice, 0.01) : null);

        return {
          id: holding.id,
          symbol: holding.symbol,
          shares: holding.shares,
          allocationPct: allocation?.allocationPct ?? null,
          positionValue,
          score: analysis?.score ?? null,
          ratingLabel: analysis ? RATING_BANDS[analysis.rating].label : null,
          currency: analysis?.currency ?? currentRating?.currency ?? "USD",
          loading: holding.loading,
          error: holding.error
        };
      })
      .sort((a, b) => (b.allocationPct ?? -1) - (a.allocationPct ?? -1));
  }, [currentRating?.currency, portfolioAllocationById, portfolioHoldings]);

  const portfolioWheelRows = useMemo(() => {
    if (portfolioAggregatorRows.length === 0) return [];
    const baseWeights = portfolioAggregatorRows.map((row) => {
      if (typeof row.allocationPct === "number" && Number.isFinite(row.allocationPct)) {
        return Math.max(row.allocationPct, 0);
      }
      return 0;
    });
    const hasAllocation = baseWeights.some((weight) => weight > 0);
    const fallbackWeight = 100 / Math.max(1, portfolioAggregatorRows.length);
    const weights = hasAllocation ? baseWeights : portfolioAggregatorRows.map(() => fallbackWeight);
    const totalWeight = Math.max(0.00001, weights.reduce((sum, weight) => sum + weight, 0));

    let cursor = -90;
    return portfolioAggregatorRows.map((row, index) => {
      const normalizedWeight = weights[index] / totalWeight;
      const startAngle = cursor;
      const endAngle = cursor + normalizedWeight * 360;
      cursor = endAngle;
      return {
        ...row,
        normalizedWeight,
        startAngle,
        endAngle
      };
    });
  }, [portfolioAggregatorRows]);

  const activePortfolioWheelRow = useMemo(() => {
    if (portfolioWheelRows.length === 0) return null;
    const preferredId = portfolioWheelHoverId ?? portfolioDrawerHoldingId;
    if (preferredId) {
      const found = portfolioWheelRows.find((row) => row.id === preferredId);
      if (found) return found;
    }
    return portfolioWheelRows[0] ?? null;
  }, [portfolioDrawerHoldingId, portfolioWheelHoverId, portfolioWheelRows]);

  const portfolioDrawerRow = useMemo(
    () => portfolioAggregatorRows.find((row) => row.id === portfolioDrawerHoldingId) ?? null,
    [portfolioAggregatorRows, portfolioDrawerHoldingId]
  );

  useEffect(() => {
    if (view !== "portfolio") {
      setPortfolioDrawerHoldingId(null);
      setPortfolioWheelHoverId(null);
      return;
    }
    if (portfolioAggregatorRows.length === 0) {
      setPortfolioDrawerHoldingId(null);
      return;
    }
    setPortfolioDrawerHoldingId((prev) => {
      if (!prev) return null;
      if (portfolioAggregatorRows.some((row) => row.id === prev)) return prev;
      return null;
    });
  }, [portfolioAggregatorRows, view]);

  const portfolioEngineInput = useMemo<PortfolioEngineInput | null>(() => {
    const rows = portfolioAggregatorRows;
    if (rows.length === 0) {
      return null;
    }

    const normalizedIndices = mergeIndexRows(indicesYtd, FALLBACK_INDICES_YTD, FALLBACK_INDICES_YTD);
    const us500 = normalizedIndices.find((item) => item.code === "US500");
    const benchmarkPoints = us500?.points ?? [];
    const monthsOfHistory =
      benchmarkPoints.length >= 30 ? 48 :
        benchmarkPoints.length >= 12 ? 12 : 6;

    const totalShares = Math.max(1, rows.reduce((sum, row) => sum + row.shares, 0));
    const holdingById = new Map(portfolioHoldings.map((holding) => [holding.id, holding]));

    const inputHoldings: PortfolioInputHolding[] = rows.map((row) => {
      const holding = holdingById.get(row.id);
      const analysis = holding?.analysis ?? null;
      const fallbackWeight = row.shares / totalShares;
      const normalizedWeight = row.allocationPct !== null ? row.allocationPct / 100 : fallbackWeight;
      return {
        ticker: row.symbol,
        name: analysis?.companyName ?? row.symbol,
        weight: normalizedWeight,
        shares: row.shares,
        price: analysis?.currentPrice ?? null,
        sector: analysis?.sector ?? null,
        eldarScore: row.score,
        rating: analysis?.rating ?? null
      };
    });

    return {
      portfolioId: currentUserId ?? "local-portfolio",
      asOfDate: new Date().toISOString().slice(0, 10),
      holdings: inputHoldings,
      benchmarkPoints,
      monthsOfHistory
    };
  }, [currentUserId, indicesYtd, portfolioAggregatorRows, portfolioHoldings]);

  const portfolioRatingData = useMemo(() => {
    if (!portfolioEngineInput) return null;
    return scorePortfolio(portfolioEngineInput);
  }, [portfolioEngineInput]);

  const activePortfolioRating = portfolioRatingData ?? persistedPortfolioSnapshot?.rating ?? null;

  const comparisonEntries = useMemo(() => {
    const output: Array<{
      symbol: string;
      analysis: PersistedAnalysis | null;
      loading: boolean;
      error: string | null;
      score: number;
      sectorScore: number;
      ratingLabel: string;
      heat: "HOT" | "NEUTRAL" | "COLD";
    }> = [];

    for (const symbol of comparisonSymbols) {
      if (currentRating && symbol === currentRating.symbol) {
        output.push({
          symbol,
          analysis: currentRating,
          loading: false,
          error: null,
          score: currentRating.score,
          sectorScore: currentRating.score,
          ratingLabel: RATING_BANDS[currentRating.rating].label,
          heat: sectorHeatFromScore(currentRating.score)
        });
        continue;
      }

      const state = comparisonStateBySymbol[symbol];
      const analysis = state?.analysis ?? null;
      const score = analysis?.score ?? 0;

      output.push({
        symbol,
        analysis,
        loading: Boolean(state?.loading),
        error: state?.error ?? null,
        score,
        sectorScore: score,
        ratingLabel: analysis ? RATING_BANDS[analysis.rating].label : "PENDING",
        heat: sectorHeatFromScore(score)
      });
    }

    return output.slice(0, 3);
  }, [comparisonSymbols, comparisonStateBySymbol, currentRating]);

  const signalShareCardData = useMemo<SignalCardProps | null>(() => {
    if (!currentRating) return null;

    const positiveSignals = ratingContextSummary.keySignals
      .filter((signal) => signal.tone === "positive")
      .map((signal) => signal.text);
    const riskSignals = ratingContextSummary.keySignals
      .filter((signal) => signal.tone === "risk")
      .map((signal) => signal.text);

    const fallbackDrivers = ratingContextSummary.topDrivers
      .map((driver) => driver.split(":")[0]?.trim() ?? driver)
      .filter(Boolean)
      .slice(0, 4);
    const fallbackRisks = [...currentRating.factors]
      .filter((factor) => factor.hasData)
      .sort((left, right) => left.points - right.points)
      .map((factor) => factor.factor)
      .slice(0, 3);

    const symbolRows = history
      .filter((row) => row.symbol === currentRating.symbol)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const previous = symbolRows.length >= 2 ? symbolRows[symbolRows.length - 2] : null;
    const scoreChange = previous ? currentRating.score - previous.score : undefined;
    const topPercentile =
      typeof ratingContextSummary.topPercentile === "number" ? ratingContextSummary.topPercentile : null;

    return {
      ticker: currentRating.symbol,
      companyName: currentRating.companyName,
      sector: currentRating.sector,
      score: currentRating.score,
      rating: currentRating.rating,
      confidence: toConfidenceLevel(currentRating.dataCompleteness),
      drivers: (positiveSignals.length > 0 ? positiveSignals : fallbackDrivers).slice(0, 4),
      risks: (riskSignals.length > 0 ? riskSignals : fallbackRisks).slice(0, 3),
      sectorRank: topPercentile === null ? undefined : Math.max(1, Math.min(99, Math.round(topPercentile))),
      scoreChange
    };
  }, [currentRating, history, ratingContextSummary]);

  const portfolioShareCardData = useMemo<PortfolioXRayCardProps | null>(() => {
    if (!activePortfolioRating) return null;

    const strongBuyPct = Math.round(
      activePortfolioRating.holdings
        .filter((holding) => holding.rating === "STRONG_BUY")
        .reduce((sum, holding) => sum + holding.weight, 0) * 100
    );
    const strongSellPct = Math.round(
      activePortfolioRating.holdings
        .filter((holding) => holding.rating === "STRONG_SELL")
        .reduce((sum, holding) => sum + holding.weight, 0) * 100
    );

    return {
      portfolioName: "ELDAR Portfolio",
      compositeScore: activePortfolioRating.compositeScore,
      stars: activePortfolioRating.stars,
      rating: activePortfolioRating.rating,
      peerGroup: activePortfolioRating.peerGroup,
      strongBuyPct,
      strongSellPct,
      topHoldings: [...activePortfolioRating.holdings]
        .sort((left, right) => right.weight - left.weight)
        .slice(0, 5)
        .map((holding) => ({
          ticker: holding.ticker,
          weight: holding.weight * 100,
          score: holding.eldarScore ?? 0,
          rating: holding.rating ?? "HOLD"
        }))
    };
  }, [activePortfolioRating]);

  const comparisonShareCardData = useMemo<{ stockA: ComparisonStock; stockB: ComparisonStock } | null>(() => {
    if (!currentRating) return null;

    const stockA: ComparisonStock = {
      ticker: currentRating.symbol,
      name: currentRating.companyName,
      score: currentRating.score,
      rating: currentRating.rating,
      factors: buildComparisonFactorTuple(currentRating)
    };

    const loadedComparison = comparisonEntries.find(
      (entry) => entry.symbol !== currentRating.symbol && entry.analysis && !entry.loading
    )?.analysis;
    const fallbackFromHistory = history.find((row) => row.symbol !== currentRating.symbol) ?? null;
    const chosen = loadedComparison ?? fallbackFromHistory;
    if (!chosen) return null;

    const stockB: ComparisonStock = {
      ticker: chosen.symbol,
      name: chosen.companyName,
      score: chosen.score,
      rating: chosen.rating,
      factors: buildComparisonFactorTuple(chosen)
    };

    return { stockA, stockB };
  }, [comparisonEntries, currentRating, history]);

  const handleExportShareCard = useCallback(async (): Promise<void> => {
    try {
      setShareExporting(true);
      setShareError("");

      if (!shareCardRef.current) {
        throw new Error("Share card is not ready.");
      }

      const filenameBase =
        shareCardKind === "signal"
          ? `${signalShareCardData?.ticker ?? "stock"}-signal`
          : shareCardKind === "portfolio"
            ? "portfolio-xray"
            : `${comparisonShareCardData?.stockA.ticker ?? "stock"}-vs-${comparisonShareCardData?.stockB.ticker ?? "stock"}`;

      await exportCard(shareCardRef, filenameBase);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export share card.";
      setShareError(message);
    } finally {
      setShareExporting(false);
    }
  }, [comparisonShareCardData, shareCardKind, signalShareCardData]);

  useEffect(() => {
    if (!currentUserId || !portfolioEngineInput || !portfolioRatingData) {
      return;
    }

    const payloadHash = JSON.stringify({
      portfolioId: portfolioEngineInput.portfolioId,
      asOfDate: portfolioEngineInput.asOfDate,
      holdings: portfolioEngineInput.holdings.map((holding) => ({
        ticker: holding.ticker,
        shares: holding.shares,
        weight: Number(holding.weight.toFixed(6)),
        score: holding.eldarScore,
        rating: holding.rating
      })),
      benchmarkCount: portfolioEngineInput.benchmarkPoints.length,
      monthsOfHistory: portfolioEngineInput.monthsOfHistory ?? null,
      compositeScore: portfolioRatingData.compositeScore
    });

    if (payloadHash === portfolioPersistHashRef.current) {
      return;
    }

    if (portfolioPersistTimeoutRef.current !== null) {
      window.clearTimeout(portfolioPersistTimeoutRef.current);
      portfolioPersistTimeoutRef.current = null;
    }

    portfolioPersistTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/portfolio", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            cache: "no-store",
            body: JSON.stringify(portfolioEngineInput)
          });

          const payload = (await response.json()) as {
            snapshot?: PersistedPortfolioSnapshot;
            error?: string;
          };

          if (!response.ok || !payload.snapshot) {
            throw new Error(payload.error ?? "Failed to persist portfolio snapshot.");
          }

          portfolioPersistHashRef.current = payloadHash;
          setPersistedPortfolioSnapshot(payload.snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to persist portfolio snapshot.";
          console.warn(`[Stock Dashboard]: ${message}`);
        }
      })();
    }, 550);

    return () => {
      if (portfolioPersistTimeoutRef.current !== null) {
        window.clearTimeout(portfolioPersistTimeoutRef.current);
        portfolioPersistTimeoutRef.current = null;
      }
    };
  }, [currentUserId, portfolioEngineInput, portfolioRatingData]);

  const renderCommandPalette = (): JSX.Element | null => {
    if (!isCommandPaletteOpen) {
      return null;
    }

    return (
      <div
        className="fixed inset-0 z-[90] bg-[#090a0c]/78 px-4 backdrop-blur-md"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeCommandPalette();
          }
        }}
      >
        <div
          className="mx-auto mt-24 w-full max-w-2xl rounded-3xl border border-white/20 bg-[#111317]/95 shadow-2xl shadow-black/70"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          <div className="border-b border-white/10 p-4">
            <div className="eldar-panel flex items-center gap-3 rounded-2xl px-4 py-3">
              <Search className="h-4 w-4 text-white/60" />
              <input
                ref={paletteInputRef}
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                onBlur={() => {
                  if (!isCommandPaletteOpen) return;
                  window.setTimeout(() => {
                    if (!isCommandPaletteOpen) return;
                    paletteInputRef.current?.focus({ preventScroll: true });
                  }, 0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeCommandPalette();
                    return;
                  }

                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setPaletteSelectionIndex((prev) =>
                      paletteResults.length === 0 ? 0 : (prev + 1) % paletteResults.length
                    );
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setPaletteSelectionIndex((prev) =>
                      paletteResults.length === 0 ? 0 : (prev - 1 + paletteResults.length) % paletteResults.length
                    );
                    return;
                  }

                  if (event.key === "Enter") {
                    event.preventDefault();

                    if (paletteResults.length > 0) {
                      const selected = paletteResults[paletteSelectionIndex] ?? paletteResults[0];
                      if (selected) {
                        selectSearchItem(selected);
                      }
                      return;
                    }

                    if (paletteQuery.trim()) {
                      closeCommandPalette();
                      if (paletteAction === "portfolio-add") {
                        setPortfolioInputTicker(paletteQuery.trim().toUpperCase());
                      } else if (paletteAction === "compare-add") {
                        void addComparisonSymbol(paletteQuery.trim().toUpperCase());
                      } else if (paletteAction === "watchlist-add") {
                        void addWatchlistSymbolDirect(paletteQuery.trim().toUpperCase());
                      } else {
                        void analyzeSymbol(paletteQuery);
                      }
                    }
                  }
                }}
                placeholder="Search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full bg-transparent text-sm font-medium tracking-wide text-white placeholder-white/45 outline-none"
              />
              {paletteQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => {
                    setPaletteQuery("");
                    setPaletteSelectionIndex(0);
                    paletteInputRef.current?.focus();
                  }}
                  className="rounded-lg border border-white/20 bg-white/5 p-1 text-white/60 transition hover:border-white/35 hover:bg-white/10 hover:text-white"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <span className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
                Esc
              </span>
            </div>
            <p className="eldar-caption mt-2 text-left text-[10px] text-white/45">
              {paletteAction === "portfolio-add"
                ? "Enter to select ticker"
                : paletteAction === "compare-add"
                  ? "Enter to compare"
                  : paletteAction === "watchlist-add"
                    ? "Enter to add to watchlist"
                  : "Enter to analyze"}
            </p>
          </div>

          <div onWheelCapture={handlePopupWheel} className="eldar-scrollbar max-h-[420px] overflow-y-auto overscroll-contain p-2">
            {paletteLoading ? (
              <div className="px-3 py-4">
                <LinesSkeleton rows={5} />
              </div>
            ) : null}

            {!paletteLoading && paletteError ? (
              <div className="mx-2 my-2 rounded-xl border border-zinc-400/35 bg-zinc-300/10 px-3 py-2 text-sm text-zinc-100">
                {paletteError}
              </div>
            ) : null}

            {!paletteLoading && !paletteError && paletteQuery.trim() && paletteResults.length === 0 ? (
              <div className="px-3 py-2">
                <EmptyState
                  icon="🔎"
                  message="No matching symbols found"
                  action={{ label: "Clear", onClick: () => setPaletteQuery("") }}
                />
              </div>
            ) : null}

            {!paletteLoading && !paletteError && paletteResults.length > 0 ? (
              <div className="space-y-1">
                {paletteResults.map((item, index) => {
                  const isSelected = index === paletteSelectionIndex;

                  return (
                    <button
                      key={`${item.symbol}-${index}`}
                      onClick={() => selectSearchItem(item)}
                      onMouseEnter={() => setPaletteSelectionIndex(index)}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition",
                        isSelected
                        ? "border-zinc-200/70 bg-zinc-200/15"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                    )}
                    >
                      <CompanyLogo
                        ticker={item.symbol}
                        domain={item.domain}
                        sector={item.sector}
                        companyName={item.companyName}
                        size={34}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{item.companyName}</p>
                        <p className="truncate font-mono text-xs uppercase tracking-[0.16em] text-white/75">
                          ${item.symbol}
                        </p>
                        <p className="truncate text-[11px] uppercase tracking-[0.14em] text-white/45">
                          {item.sector}
                        </p>
                      </div>
                      <span className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/70">
                        {paletteAction === "portfolio-add"
                          ? "Select"
                          : paletteAction === "compare-add"
                            ? "Compare"
                            : paletteAction === "watchlist-add"
                              ? "Add"
                              : "Analyze"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {!paletteQuery.trim() ? (
              <div className="px-3 py-2">
                <EmptyState
                  icon="⌨️"
                  message="Type a ticker or company name"
                  action={{ label: "Search", onClick: () => paletteInputRef.current?.focus() }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderShortcutsModal = (): JSX.Element | null => {
    if (!showShortcuts) return null;
    return (
      <div
        className="fixed inset-0 z-[94] bg-[#090a0c]/78 px-4 backdrop-blur-md"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setShowShortcuts(false);
          }
        }}
      >
        <div className="eldar-panel mx-auto mt-24 w-full max-w-md rounded-3xl p-5" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
          <div className="mb-4 flex items-center justify-between">
            <h3 id="shortcuts-title" className="text-sm font-semibold text-white">
              Keyboard Shortcuts
            </h3>
            <button
              type="button"
              onClick={() => setShowShortcuts(false)}
              className="eldar-btn-ghost rounded-lg border px-2 py-1 text-xs"
            >
              Esc
            </button>
          </div>
          <div className="space-y-2">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between border-b border-white/10 pb-2 text-xs">
                <span className="text-white/70">{shortcut.description}</span>
                <span className="font-mono text-white">{shortcut.key}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderProfileModal = (): JSX.Element | null => {
    if (!isProfileOpen) {
      return null;
    }

    const inputClassName = clsx(
      "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition",
      themeMode === "dark"
        ? "border-white/24 bg-white/5 text-white placeholder-white/45 focus:border-white/45 focus:bg-white/10"
        : "border-slate-400/40 bg-white/85 text-slate-900 placeholder-slate-500 focus:border-slate-500/60 focus:bg-white"
    );

    return (
      <div
        className={clsx(
          "fixed inset-0 z-[95] px-4 backdrop-blur-md",
          themeMode === "dark" ? "bg-[#090a0c]/80" : "bg-slate-300/40"
        )}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeProfileModal();
          }
        }}
      >
        <div
          className="eldar-panel mx-auto mt-24 w-full max-w-md rounded-3xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-2">
              <div className="relative h-6 w-6 overflow-hidden">
                <Image src={ELDAR_BRAND_LOGO} alt="ELDAR logo" fill sizes="24px" className="object-contain" />
              </div>
              <p className="eldar-display text-sm text-white/90">ELDAR Profile</p>
            </div>
            <button
              type="button"
              onClick={closeProfileModal}
              className="eldar-btn-ghost rounded-lg border p-1.5 text-white/80"
              aria-label="Close profile modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5">
            <div className="mb-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={clsx(
                  "rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition",
                  authMode === "login"
                    ? "eldar-btn-silver text-slate-900"
                    : "eldar-btn-ghost text-white/85"
                )}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("signup")}
                className={clsx(
                  "rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition",
                  authMode === "signup"
                    ? "eldar-btn-silver text-slate-900"
                    : "eldar-btn-ghost text-white/85"
                )}
              >
                Sign Up
              </button>
            </div>

            <form className="space-y-3">
              {authMode === "signup" ? (
                <input
                  type="text"
                  placeholder="Full name"
                  className={inputClassName}
                />
              ) : null}
              <input
                type="email"
                placeholder="Email"
                className={inputClassName}
              />
              <input
                type="password"
                placeholder="Password"
                className={inputClassName}
              />
              {authMode === "signup" ? (
                <input
                  type="password"
                  placeholder="Confirm password"
                  className={inputClassName}
                />
              ) : null}

              <button type="button" className="eldar-btn-silver mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold">
                {authMode === "login" ? "Login" : "Create Account"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  };

  const renderShareModal = (): JSX.Element | null => {
    if (!shareModalOpen) return null;

    const previewWidth = 1080;
    const previewHeight = 1920;
    const previewScale = 0.31;
    const title = shareCardKind === "portfolio" ? "Portfolio Share Card" : "Share Card Export";

    let cardNode: JSX.Element | null = null;
    if (shareCardKind === "signal" && signalShareCardData) {
      cardNode = <SignalCard {...signalShareCardData} />;
    } else if (shareCardKind === "portfolio" && portfolioShareCardData) {
      cardNode = <PortfolioXRayCard {...portfolioShareCardData} />;
    } else if (shareCardKind === "comparison" && comparisonShareCardData) {
      cardNode = <ComparisonCard stockA={comparisonShareCardData.stockA} stockB={comparisonShareCardData.stockB} />;
    }

    return (
      <div
        className="fixed inset-0 z-[96] bg-[#090a0c]/82 px-4 backdrop-blur-md"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeShareModal();
          }
        }}
      >
        <div className="mx-auto mt-10 w-full max-w-5xl rounded-3xl border border-white/20 bg-[#0b0d10] p-5 shadow-2xl shadow-black/70">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/85">{title}</h3>
            <button
              type="button"
              onClick={closeShareModal}
              className="eldar-btn-ghost rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
            >
              Close
            </button>
          </div>

          <div onWheelCapture={handlePopupWheel} className="eldar-scrollbar max-h-[70vh] overflow-auto rounded-2xl border border-white/15 bg-black/60 p-4">
            {cardNode ? (
              <div style={{ width: previewWidth * previewScale, height: previewHeight * previewScale }}>
                <div style={{ transform: `scale(${previewScale})`, transformOrigin: "top left" }}>
                  <div ref={shareCardRef}>{cardNode}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/70">This share card is not available yet for the current data state.</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-white/65">Use the export button to generate a PNG sized for X posting.</p>
            <button
              type="button"
              onClick={() => void handleExportShareCard()}
              disabled={shareExporting || !cardNode}
              className="eldar-share-trigger eldar-btn-silver inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] disabled:opacity-55"
            >
              <Share2 className="h-4 w-4" />
              {shareExporting ? "Exporting..." : "Export PNG"}
            </button>
          </div>
          {shareError ? <p className="mt-2 text-xs text-red-300">{shareError}</p> : null}
        </div>
      </div>
    );
  };

  const renderHomeTickerDrawer = (): JSX.Element | null => {
    if (!homeTickerDrawer) return null;

    return (
      <div className="fixed inset-0 z-[95]">
        <button
          type="button"
          aria-label="Close drawer"
          className="absolute inset-0 bg-black/45"
          onClick={() => setHomeTickerDrawer(null)}
        />
        <aside onWheelCapture={handlePopupWheel} className="eldar-scrollbar card-grain rough-border absolute right-0 top-0 h-full w-full max-w-[480px] overflow-y-auto overscroll-contain border-l border-white/15 bg-[#0a0a0a] p-5 shadow-2xl shadow-black/70">
          <div className="sticky top-0 z-10 mb-4 flex items-center justify-between border-b border-white/10 bg-[#0a0a0a] pb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">
                {homeTickerDrawer.source === "earnings" ? "Earnings Detail" : "Market Mover"}
              </p>
              <p className="mt-1 font-mono text-xl font-bold text-white">${homeTickerDrawer.symbol}</p>
            </div>
            <button
              type="button"
              onClick={() => setHomeTickerDrawer(null)}
              className="eldar-btn-ghost min-h-[40px] rounded-xl px-3 text-xs font-semibold uppercase tracking-[0.12em]"
            >
              Close
            </button>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/12 bg-black/25 p-3">
              <p className="text-sm font-semibold text-white">{homeTickerDrawer.companyName}</p>
              <p className="mt-2 text-xs text-white/70">
                {homeTickerDrawer.date ? formatEarningsDate(homeTickerDrawer.date) : "No scheduled date"}
                {homeTickerDrawer.epsEstimate !== null ? ` · Est EPS ${homeTickerDrawer.epsEstimate.toFixed(2)}` : ""}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Price</p>
                <p className="mt-1 font-mono text-lg font-semibold text-white">
                  {homeTickerDrawer.currentPrice !== null ? `$${homeTickerDrawer.currentPrice.toFixed(2)}` : "Pending"}
                </p>
              </div>
              <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Move</p>
                <p
                  className={clsx(
                    "mt-1 font-mono text-lg font-semibold",
                    homeTickerDrawer.changePercent !== null && homeTickerDrawer.changePercent > 0 && "text-emerald-300",
                    homeTickerDrawer.changePercent !== null && homeTickerDrawer.changePercent < 0 && "text-red-300",
                    homeTickerDrawer.changePercent === null && "text-white"
                  )}
                >
                  {homeTickerDrawer.changePercent !== null
                    ? `${homeTickerDrawer.changePercent > 0 ? "+" : ""}${homeTickerDrawer.changePercent.toFixed(2)}%`
                    : "Pending"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/12 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">ELDAR</p>
              <p className="mt-1 text-xs text-white/75">
                Instant full analysis with fundamentals, valuation, momentum, and sentiment context.
              </p>
            </div>
          </div>

          <div className="sticky bottom-0 z-10 mt-5 flex items-center gap-2 border-t border-white/10 bg-[#0a0a0a] pt-3">
            <button
              type="button"
              onClick={() => {
                const symbol = homeTickerDrawer.symbol;
                setHomeTickerDrawer(null);
                setTicker(symbol);
                void analyzeSymbol(symbol);
              }}
              className="eldar-btn-silver min-h-[44px] flex-1 rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            >
              Analyze
            </button>
            <button
              type="button"
              onClick={() => {
                const symbol = homeTickerDrawer.symbol;
                setHomeTickerDrawer(null);
                void addWatchlistSymbolDirect(symbol);
              }}
              className="eldar-btn-ghost min-h-[44px] flex-1 rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            >
              Add to Watchlist
            </button>
          </div>
        </aside>
      </div>
    );
  };

  const topRightAccountDock = view === "home" ? (
    <div className="fixed right-[clamp(16px,2.2vw,36px)] top-4 z-[65] flex items-center gap-2">
      <button
        type="button"
        onClick={() => setView("watchlist")}
        className="eldar-nav-icon inline-flex h-10 w-10 items-center justify-center text-white/85"
        aria-label="Watchlist"
      >
        <Star className="h-4 w-4" />
      </button>
      <SignedOut>
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/85 transition hover:border-white/55 hover:text-white"
          >
            Sign In
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </div>
  ) : null;

  if (!isAppOpen) {
    return <HeroLanding logoSrc={ELDAR_BRAND_LOGO} scores={initialMag7Scores} onOpenApp={openApp} />;
  }

  if (view === "home") {
    const snapshotItems = homeDashboard?.snapshot ?? [];
    const snapshotByLabel = new Map(snapshotItems.map((item) => [item.label, item]));
    const snapshotChartSeries = [
      { code: "US500" as const, label: "SPX" as const },
      { code: "US100" as const, label: "NDX" as const },
      { code: "US2000" as const, label: "RUT" as const }
    ].map((entry) => {
      const indexRow = indicesYtd.find((item) => item.code === entry.code);
      const snapshotRow = snapshotByLabel.get(entry.label);
      return {
        label: entry.label,
        points: indexRow?.points ?? [],
        changePercent: snapshotRow?.changePercent ?? indexRow?.ytdChangePercent ?? null
      };
    });
    const rankedMarketMovers = homeDashboard?.marketMovers ?? [];
    const sectorRotationRows = homeDashboard?.sectorRotation ?? [];
    const marketNews = homeDashboard?.marketNews ?? [];
    const analyzeHomeSymbol = (symbol: string): void => {
      setTicker(symbol);
      void analyzeSymbol(symbol);
    };
    return (
      <div
        className="min-h-screen overflow-x-hidden text-white"
        style={{
          background: appBackground
        }}
      >
        <NavigationSidebar
          view={view}
          themeMode={themeMode}
          loading={loading}
          marketOpen={isMarketOpen}
          profileOpen={isProfileOpen}
          menuContext="home"
          headerVisible={headerVisible}
          showFadeTransition={showFadeTransition}
          defaultSearchValue={ticker}
          onToggleTheme={toggleThemeMode}
          onHome={goHomeView}
          onOpenSectors={openSectorsPage}
          onOpenMacro={openMacroPage}
          onOpenJournal={() => openJournalPage()}
          onPortfolio={() => setView("portfolio")}
          onQuickSearch={(value) => openCommandPalette(value)}
        />
        {topRightAccountDock}
        <div className="eldar-main-layout pb-20">
            <div ref={heroSectionRef} className="eldar-page-width-xl">
              <div className="reveal-block mb-6 flex flex-col items-start gap-3">
                <button
                  type="button"
                  onClick={() => openCommandPalette(ticker)}
                  disabled={loading}
                  className="eldar-search-shell primary-cta flex h-14 w-full max-w-[520px] items-center justify-between rounded-3xl px-5 text-left text-sm font-medium transition-all duration-300"
                >
                  <span className="flex items-center gap-3 text-white/68">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                    {loading ? `Analyzing ${ticker || "symbol"}...` : "search stock"}
                  </span>
                  <span className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/42">/</span>
                </button>

              {apiError ? (
                <div className="w-full max-w-[560px] rounded-2xl border border-zinc-400/35 bg-zinc-300/10 p-4 backdrop-blur-xl">
                  <p className="text-sm text-zinc-100">{apiError}</p>
                </div>
              ) : null}
            </div>

            <div className="reveal-block grid gap-4 xl:grid-cols-12" style={{ transitionDelay: "80ms" }}>
              <MacroEnvironmentCard regime={homeDashboard?.regime ?? null} loading={homeDashboardLoading && !homeDashboard} />

              {homeDashboardLoading && !homeDashboard ? (
                <section className="eldar-panel texture-none p-5 xl:col-span-4">
                  <div className="mb-5">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Market News</p>
                  </div>
                  <LinesSkeleton rows={4} />
                </section>
              ) : (
                <MarketNewsPanel items={marketNews} />
              )}

              <section className="eldar-panel texture-none xl:col-span-7 p-5">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Market Snapshot</p>
                </div>
                {homeDashboardLoading && !homeDashboard ? (
                  <LinesSkeleton rows={3} />
                ) : (
                  <MarketSnapshotChart series={snapshotChartSeries} />
                )}
              </section>

              {homeDashboardLoading && !homeDashboard ? (
                <section className="eldar-panel texture-none xl:col-span-8 p-5">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Sector Rotation</p>
                    <div className="h-8 w-[168px] rounded-full border border-white/10 bg-white/[0.03]" />
                  </div>
                  <LinesSkeleton rows={6} />
                </section>
              ) : (
                <SectorRotationBoard
                  rows={sectorRotationRows}
                  currentWindow={homeDashboard?.sectorWindow ?? sectorRotationWindow}
                  onWindowChange={setSectorRotationWindow}
                />
              )}

              <section className="eldar-panel texture-none xl:col-span-4 p-5">
                <div className="mb-5">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Market Movers</p>
                </div>
                {homeDashboardLoading && !homeDashboard ? (
                  <LinesSkeleton rows={5} />
                ) : rankedMarketMovers.length === 0 ? (
                  <div className="flex min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-white/10 text-center text-sm text-white/46">
                    No New York session mover data available.
                  </div>
                ) : (
                  <MarketMoverStack items={rankedMarketMovers} onAnalyze={analyzeHomeSymbol} />
                )}
              </section>
            </div>
            {homeDashboardError ? (
              <p className="mt-3 text-xs text-zinc-200/80">{homeDashboardError}</p>
            ) : null}
          </div>
        </div>
        {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
        {renderCommandPalette()}
        {renderShortcutsModal()}
        {renderProfileModal()}
        {renderShareModal()}
        {renderHomeTickerDrawer()}
      </div>
    );
  }

  if (view === "results" && !currentRating) {
    return (
      <div className="min-h-screen text-white" style={{ background: appBackground }}>
        <NavigationSidebar
          view={view}
          themeMode={themeMode}
          loading={loading}
          marketOpen={isMarketOpen}
          profileOpen={isProfileOpen}
          menuContext="home"
          headerVisible={headerVisible}
          showFadeTransition={showFadeTransition}
          defaultSearchValue={ticker}
          onToggleTheme={toggleThemeMode}
          onHome={goHomeView}
          onOpenSectors={openSectorsPage}
          onOpenMacro={openMacroPage}
          onOpenJournal={() => openJournalPage()}
          onPortfolio={() => setView("portfolio")}
          onQuickSearch={(value) => openCommandPalette(value)}
        />
        {topRightAccountDock}
        <div className="eldar-main-layout">
          <div className="eldar-page-width-lg">
            <div className="eldar-panel rounded-3xl p-8 text-center">
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/55">ELDAR Analysis</p>
              <p className="mt-3 text-2xl font-bold text-white">{pendingSymbol ?? ticker ?? "Loading"}</p>
              <p className="mt-2 text-sm text-white/70">Pulling data and computing signal context...</p>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/15 bg-zinc-950/45 p-4">
                  <LinesSkeleton rows={4} />
                </div>
                <div className="rounded-2xl border border-white/15 bg-zinc-950/45 p-4">
                  <LinesSkeleton rows={4} />
                </div>
                <div className="rounded-2xl border border-white/15 bg-zinc-950/45 p-4">
                  <LinesSkeleton rows={4} />
                </div>
              </div>
            </div>
          </div>
        </div>
        {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
        {renderCommandPalette()}
        {renderShortcutsModal()}
        {renderProfileModal()}
        {renderShareModal()}
      </div>
    );
  }

  if (view === "results" && currentRating) {
    const ratingBand = RATING_BANDS[currentRating.rating];
    const isStrongBullish = currentRating.rating === "STRONG_BUY";
    const isBullish = currentRating.rating === "BUY";
    const isBearishOrLower = currentRating.rating === "SELL" || currentRating.rating === "STRONG_SELL";
    const isInWatchlist = watchlist.some((item) => item.symbol === currentRating.symbol);
    const driverBullets = ratingContextSummary.topDrivers.slice(0, 10);
    const riskBullets = ratingContextSummary.keySignals
      .filter((signal) => signal.tone === "risk")
      .map((signal) => signal.text);
    const visibleJournalEntries = showAllJournalLinks
      ? journalRelatedEntries
      : journalRelatedEntries.slice(0, JOURNAL_VISIBLE_COUNT);
    const hiddenJournalLinksCount = Math.max(0, journalRelatedEntries.length - visibleJournalEntries.length);
    const signalHeroTone =
      currentRating.rating === "STRONG_BUY"
        ? "strongBuy"
        : currentRating.rating === "BUY"
          ? "buy"
          : currentRating.rating === "SELL"
            ? "sell"
            : currentRating.rating === "STRONG_SELL"
              ? "strongSell"
              : "hold";
    const similarStocksFallback = POPULAR_STOCKS
      .filter((symbol) => symbol !== currentRating.symbol)
      .slice(0, 3)
      .map((symbol) => ({
        symbol,
        companyName: mag7Cards.find((card) => card.symbol === symbol)?.companyName ?? symbol
      }));

    return (
      <div
        className="min-h-screen text-white"
        style={{
          background: appBackground
        }}
      >
        <NavigationSidebar
          view={view}
          themeMode={themeMode}
          loading={loading}
          marketOpen={isMarketOpen}
          profileOpen={isProfileOpen}
          menuContext="home"
          headerVisible={headerVisible}
          showFadeTransition={showFadeTransition}
          defaultSearchValue={ticker}
          onToggleTheme={toggleThemeMode}
          onHome={goHomeView}
          onOpenSectors={openSectorsPage}
          onOpenMacro={openMacroPage}
          onOpenJournal={() => openJournalPage()}
          onPortfolio={() => setView("portfolio")}
          onQuickSearch={(value) => openCommandPalette(value)}
        />
        {topRightAccountDock}
        <div className="eldar-main-layout">
          <div className="eldar-page-width-lg">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={goHomeView}
                aria-label="New Analysis"
                className="eldar-btn-silver inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>

            </div>

            {apiError ? (
              <div className="mb-5 rounded-xl border border-zinc-400/35 bg-zinc-300/10 px-4 py-3 text-sm text-zinc-100">
                {apiError}
              </div>
            ) : null}

            <div className="reveal-block grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]">
              <div className="space-y-6">
                <SignalHero
                  symbol={currentRating.symbol}
                  companyName={currentRating.companyName}
                  eyebrow="ELDAR Analysis"
                  rating={ratingBand.label}
                  scoreLabel="Composite signal strength"
                  subcopy={`ELDAR rates this ${ratingBand.label}. Review the main drivers, downside risks, and market context before you add it to the watchlist or compare it.`}
                  contextLine={`${currentRating.sector} · ${formatPrice(currentRating.currentPrice, currentRating.currency)} · Market Cap ${formatMarketCap(currentRating.marketCap)}`}
                  tone={signalHeroTone}
                  meterPercent={currentRating.score * 10}
                  actions={
                    <>
                      <button
                        type="button"
                      onClick={() => {
                          if (isInWatchlist) {
                            void removeWatchlistSymbol(currentRating.symbol);
                            return;
                          }
                          void saveToWatchlist();
                        }}
                        aria-pressed={isInWatchlist}
                        aria-label={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                        className={clsx(
                          "eldar-btn-ghost inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition",
                          isInWatchlist && "border-white/30 bg-white/[0.08] text-white"
                        )}
                      >
                        <Star className={clsx("h-4 w-4", isInWatchlist && "fill-current")} />
                        {isInWatchlist ? "Saved" : "Add to Watchlist"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openShareModal("signal")}
                        aria-label="Share card"
                        className="eldar-btn-silver inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition"
                      >
                        <Share2 className="h-4 w-4" />
                        Share
                      </button>
                      {watchlistAddedSymbol === currentRating.symbol ? (
                        <span className="text-xs font-semibold text-emerald-300">Saved to watchlist</span>
                      ) : null}
                    </>
                  }
                  scoreVisual={
                    <div
                      className={clsx(
                        "flex h-40 w-40 flex-col items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                        isStrongBullish && "border-[#FFBF00]/60 bg-[#FFBF00]/14 shadow-[0_0_34px_rgba(255,191,0,0.18)]",
                        isBullish && "border-emerald-300/35 bg-emerald-300/10",
                        isBearishOrLower && "border-red-300/40 bg-red-300/10",
                        !isStrongBullish && !isBullish && !isBearishOrLower && "border-white/20 bg-white/[0.04]"
                      )}
                    >
                      <p
                        className={clsx(
                          "inked-number text-4xl font-black leading-none",
                          isStrongBullish ? "text-[#FFD76A] [text-shadow:0_0_24px_rgba(255,191,0,0.32)]" : "glow-amber text-white"
                        )}
                      >
                        <HackingScore
                          value={currentRating.score}
                          triggerKey={String(currentRating.id ?? `${currentRating.symbol}:${currentRating.createdAt}`)}
                        />
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-white/65">out of 10</p>
                    </div>
                  }
                />

                <ResultsChartsPanel
                  priceRange={priceRange}
                  priceRangeOptions={PRICE_RANGE_OPTIONS}
                  onPriceRangeChange={setPriceRange}
                  priceHistoryChangePercent={priceHistoryChangePercent}
                  priceHistoryLoading={priceHistoryLoading}
                  priceHistory={priceHistory}
                  priceHistoryError={priceHistoryError}
                  priceSparklinePath={buildSparklinePath(priceHistory.map((row) => row.price), 720, 220)}
                  priceChartOverlay={priceChartOverlay}
                  onPriceChartHoverIndex={setPriceChartHoverIndex}
                  fundamentalsSnapshot={fundamentalsSnapshot}
                  fundamentalsNumbersLoading={fundamentalsNumbersLoading}
                  fundamentalsHackTrigger={fundamentalsHackTrigger}
                  factorSignalToneClass={factorSignalToneClass}
                  scoreHistorySeries={scoreHistorySeries}
                  scoreHistoryPoints={scoreHistoryPoints}
                  scoreSparklinePath={buildSparklinePath(scoreHistoryPoints, 320, 60)}
                  scoreChartOverlay={scoreChartOverlay}
                  onScoreChartHoverIndex={setScoreChartHoverIndex}
                />

                <ScoreExplanationWidget
                  ratingNote={currentRating.ratingNote}
                  drivers={driverBullets}
                  risks={riskBullets}
                />
              </div>

              <ResultsSidebar
                currentRating={currentRating}
                stockContextLoading={stockContextLoading}
                stockContext={stockContext}
                fallbackSimilarStocks={similarStocksFallback}
                stockContextError={stockContextError}
                sectorRelative={sectorRelative}
                isNewsExpanded={isNewsExpanded}
                onToggleNewsExpanded={() => setIsNewsExpanded((prev) => !prev)}
                relatedNewsItems={relatedNewsItems}
                currentUserId={currentUserId}
                journalRelatedLoading={journalRelatedLoading}
                visibleJournalEntries={visibleJournalEntries}
                hiddenJournalLinksCount={hiddenJournalLinksCount}
                showAllJournalLinks={showAllJournalLinks}
                onToggleJournalLinks={() => setShowAllJournalLinks((value) => !value)}
                onOpenJournalThesis={() => openJournalPage({ symbol: currentRating.symbol, type: "thesis" })}
                onOpenJournalEntry={(entryId) => openJournalPage({ symbol: currentRating.symbol, entryId })}
                journalRelatedError={journalRelatedError}
                onOpenCommandPalette={() => openCommandPalette(currentRating.symbol)}
                onAnalyzeSymbol={(symbol) => {
                  setTicker(symbol);
                  void analyzeSymbol(symbol);
                }}
                onAddComparisonSymbol={(symbol) => {
                  void addComparisonSymbol(symbol);
                }}
                comparisonOpen={comparisonOpen}
                onCloseComparison={() => setComparisonOpen(false)}
                comparisonEntries={comparisonEntries}
                sectorHeatLabel={sectorHeatLabel}
                ratingLabelToneClass={ratingLabelToneClass}
                upgradePath={upgradePath}
              />
            </div>
          </div>
        </div>
        {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
        {renderCommandPalette()}
        {renderShortcutsModal()}
        {renderProfileModal()}
        {renderShareModal()}
      </div>
    );
  }

  if (view === "portfolio") {
    return (
      <div className="min-h-screen text-white" style={{ background: appBackground }}>
        <NavigationSidebar
          view={view}
          themeMode={themeMode}
          loading={loading || portfolioLoading}
          marketOpen={isMarketOpen}
          profileOpen={isProfileOpen}
          menuContext="home"
          headerVisible={headerVisible}
          showFadeTransition={showFadeTransition}
          defaultSearchValue={ticker}
          onToggleTheme={toggleThemeMode}
          onHome={goHomeView}
          onOpenSectors={openSectorsPage}
          onOpenMacro={openMacroPage}
          onOpenJournal={() => openJournalPage()}
          onPortfolio={() => setView("portfolio")}
          onQuickSearch={(value) => openCommandPalette(value, "portfolio-add")}
        />
        {topRightAccountDock}
        <div className="eldar-main-layout">
          <PortfolioMainPanel
            activePortfolioRating={activePortfolioRating}
            portfolioInputTicker={portfolioInputTicker}
            portfolioInputShares={portfolioInputShares}
            portfolioError={portfolioError}
            portfolioHoldingsCount={portfolioHoldings.length}
            portfolioWheelRows={portfolioWheelRows}
            portfolioWheelHoverId={portfolioWheelHoverId}
            portfolioDrawerHoldingId={portfolioDrawerHoldingId}
            activePortfolioWheelRow={activePortfolioWheelRow}
            onOpenShare={() => openShareModal("portfolio")}
            onOpenPaletteForAdd={(value) => openCommandPalette(value, "portfolio-add")}
            onSubmitAdd={() => {
              void addPortfolioHolding();
            }}
            onSharesChange={(value) => setPortfolioInputShares(value.replace(/[^0-9]/g, ""))}
            onWheelHover={(id) => setPortfolioWheelHoverId(id)}
            onWheelLeave={(id) => setPortfolioWheelHoverId((prev) => (prev === id ? null : prev))}
            onWheelSelect={(id) => setPortfolioDrawerHoldingId(id)}
          />
        </div>
        {portfolioDrawerRow ? (
          <PortfolioHoldingDrawer
            drawerRow={portfolioDrawerRow}
            onClose={() => setPortfolioDrawerHoldingId(null)}
            onWheelCapture={handlePopupWheel}
            onRefresh={(symbol) => {
              void refreshPortfolioHolding(symbol);
            }}
            onRemove={(id) => removePortfolioHolding(id)}
          />
        ) : null}
        {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
        {renderCommandPalette()}
        {renderShortcutsModal()}
        {renderProfileModal()}
        {renderShareModal()}
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={{ background: appBackground }}>
      <NavigationSidebar
        view={view}
        themeMode={themeMode}
        loading={loading}
        marketOpen={isMarketOpen}
        profileOpen={isProfileOpen}
        menuContext="home"
        headerVisible={headerVisible}
        showFadeTransition={showFadeTransition}
        defaultSearchValue={ticker}
        onToggleTheme={toggleThemeMode}
        onHome={goHomeView}
        onOpenSectors={openSectorsPage}
        onOpenMacro={openMacroPage}
        onOpenJournal={() => openJournalPage()}
        onPortfolio={() => setView("portfolio")}
        onQuickSearch={(value) => openCommandPalette(value)}
      />
      {topRightAccountDock}
      <div className="eldar-main-layout">
        <div className="eldar-page-width-md">
          <h1 className="mb-8 text-4xl font-black tracking-tight">Watchlist</h1>
          {watchlist.length === 0 ? (
            <div className="eldar-panel rounded-3xl p-8">
              <EmptyState icon="⭐" message="No watchlist symbols yet" action={{ label: "Add stocks", onClick: () => openCommandPalette("", "watchlist-add") }} />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {watchlist.map((item, index) => {
                const tone = item.latest ? ratingToneByLabel(item.latest.rating) : "neutral";

                return (
                  <div
                    key={item.symbol}
                    className="eldar-panel reveal-block rounded-3xl p-6 transition-all hover:border-white/30"
                    style={{ transitionDelay: `${Math.min(index, 8) * 100}ms` }}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <button
                        onClick={() => {
                          void analyzeSymbol(item.symbol);
                        }}
                        aria-label="Open Analysis"
                        className="font-mono text-xl font-bold text-white transition hover:text-zinc-200"
                      >
                        {item.symbol}
                      </button>
                      <button
                        onClick={() => {
                          void removeWatchlistSymbol(item.symbol);
                        }}
                        aria-label="Remove"
                        className="rounded-lg border border-zinc-100/55 bg-zinc-100/15 px-2 py-1 text-xs font-semibold text-zinc-100 transition hover:border-zinc-100/80 hover:bg-zinc-100/28 hover:text-white"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {item.latest ? (
                      <>
                        <div
                          className={clsx(
                            "inline-flex rounded-xl border px-3 py-2 text-sm font-bold",
                            tone === "bullish" && "border-zinc-300/40 bg-zinc-300/14 text-emerald-200",
                            tone === "neutral" && "border-slate-500/40 bg-slate-500/15 text-slate-300",
                            tone === "bearish" && "border-zinc-500/40 bg-zinc-500/15 text-red-200",
                            item.latest.rating === "STRONG_BUY" && "eldar-gold-badge",
                            item.latest.rating === "STRONG_SELL" && "eldar-red-badge"
                          )}
                        >
                          {ratingLabelFromKey(item.latest.rating)}
                        </div>
                        <p className="mt-2 text-xs text-white/70">Score {scoreLabel(item.latest.score)}</p>
                        <p className="mt-2 text-xs text-white/60">{item.latest.ratingNote}</p>
                      </>
                    ) : (
                      <p className="text-sm text-white/60">No rating saved yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
      {renderCommandPalette()}
      {renderShortcutsModal()}
      {renderProfileModal()}
      {renderShareModal()}
    </div>
  );
}
