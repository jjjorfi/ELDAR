"use client";

import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  BriefcaseBusiness,
  Grid2x2,
  Home,
  CircleUserRound,
  LineChart,
  Loader2,
  Moon,
  Plus,
  Search,
  Sun,
  X,
  Trash2,
  Info
} from "lucide-react";

import { CompanyLogo } from "@/components/CompanyLogo";
import { RATING_BANDS, toRating } from "@/lib/rating";
import type { Mag7ScoreCard, PersistedAnalysis, RatingLabel, WatchlistItem } from "@/lib/types";
import { formatMarketCap, formatPrice } from "@/lib/utils";
import { getTop100Sp500Symbols, isTop100Sp500Symbol } from "@/lib/market/top100";

type ViewMode = "home" | "results" | "watchlist" | "portfolio";
type ThemeMode = "dark" | "light";
type AuthMode = "login" | "signup";
type AnalysisPhase = "idle" | "fetching" | "rendering";
type PaletteAction = "analyze" | "portfolio-add" | "compare-add";

interface StockDashboardProps {
  initialHistory: PersistedAnalysis[];
  initialWatchlist: WatchlistItem[];
  initialMag7Scores: Mag7ScoreCard[];
  currentUserId: string | null;
}

interface SearchResultItem {
  symbol: string;
  companyName: string;
  sector: string;
  domain: string | null;
  marketCap?: number | null;
}

interface ContextSimilarStock {
  symbol: string;
  companyName: string;
}

interface ContextNewsItem {
  headline: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
}

interface StockContextData {
  symbol: string;
  sector: string;
  sectorAverageScore: number | null;
  vsSectorPercent: number | null;
  similarStocks: ContextSimilarStock[];
  news: ContextNewsItem[];
}

interface MarketMoverItem {
  symbol: string;
  companyName: string;
  currentPrice: number | null;
  changePercent: number | null;
}

interface IndexYtdItem {
  code: "US30" | "US100" | "US500";
  label: string;
  symbol: string;
  current: number | null;
  ytdChangePercent: number | null;
  asOf: string | null;
  points: number[];
}

interface UpcomingEarningsItem {
  symbol: string;
  companyName: string;
  date: string | null;
  epsEstimate: number | null;
}

interface PassedEarningsItem {
  symbol: string;
  companyName: string;
  date: string | null;
  period: string | null;
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
  outcome: "beat" | "miss" | "inline" | "unknown";
}

interface PortfolioHolding {
  id: string;
  symbol: string;
  shares: number;
  analysis: PersistedAnalysis | null;
  loading: boolean;
  error: string | null;
  expanded: boolean;
}

interface ComparisonState {
  analysis: PersistedAnalysis | null;
  loading: boolean;
  error: string | null;
}

const POPULAR_STOCKS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];
const FALLBACK_UPCOMING_EARNINGS: UpcomingEarningsItem[] = [
  { symbol: "AAPL", companyName: "Apple Inc.", date: null, epsEstimate: null },
  { symbol: "MSFT", companyName: "Microsoft Corporation", date: null, epsEstimate: null },
  { symbol: "NVDA", companyName: "NVIDIA Corporation", date: null, epsEstimate: null }
];
const FALLBACK_PASSED_EARNINGS: PassedEarningsItem[] = [
  {
    symbol: "AMZN",
    companyName: "Amazon.com, Inc.",
    date: null,
    period: null,
    actual: null,
    estimate: null,
    surprisePercent: null,
    outcome: "unknown"
  },
  {
    symbol: "GOOGL",
    companyName: "Alphabet Inc.",
    date: null,
    period: null,
    actual: null,
    estimate: null,
    surprisePercent: null,
    outcome: "unknown"
  },
  {
    symbol: "META",
    companyName: "Meta Platforms, Inc.",
    date: null,
    period: null,
    actual: null,
    estimate: null,
    surprisePercent: null,
    outcome: "unknown"
  }
];
const TOP_100_SYMBOLS = getTop100Sp500Symbols();
const COMMAND_PALETTE_LIMIT = 12;

const RSS_TICKER_ID = "_TY28wH8o2RkP29Ic";
const RSS_PARKING_ID = "eldar-rss-parking";
const ELDAR_BRAND_LOGO = "/brand/eldar-logo.png";
const DASHBOARD_RETURN_STATE_KEY = "eldar:dashboard:return-state";
const ANALYSIS_CACHE_TTL_MS = 90_000;

function ensureRssParkingNode(): HTMLDivElement {
  const existing = document.getElementById(RSS_PARKING_ID);
  if (existing && existing instanceof HTMLDivElement) {
    return existing;
  }

  const parking = document.createElement("div");
  parking.id = RSS_PARKING_ID;
  parking.style.position = "fixed";
  parking.style.left = "-99999px";
  parking.style.top = "0";
  parking.style.width = "1px";
  parking.style.height = "1px";
  parking.style.overflow = "hidden";
  parking.style.pointerEvents = "none";
  parking.style.opacity = "0";
  document.body.appendChild(parking);
  return parking;
}

function ensureRssTickerElement(): HTMLElement {
  const parking = ensureRssParkingNode();
  const existing = document.querySelector(`rssapp-ticker[data-eldar-rss="1"]`);
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const ticker = document.createElement("rssapp-ticker");
  ticker.setAttribute("id", RSS_TICKER_ID);
  ticker.setAttribute("data-eldar-rss", "1");
  parking.appendChild(ticker);
  return ticker;
}

const NewsTickerBar = memo(function NewsTickerBar(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const ticker = ensureRssTickerElement();
    if (ticker.parentElement !== host) {
      host.appendChild(ticker);
    }

    return () => {
      const parking = ensureRssParkingNode();
      if (ticker.parentElement !== parking) {
        parking.appendChild(ticker);
      }
    };
  }, []);

  return (
    <div className="relative hidden flex-1 items-center px-2 md:flex">
      <div className="eldar-rss-shell w-full [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div ref={hostRef} className="min-h-[24px]" />
      </div>
    </div>
  );
});

interface EldarLogoProps {
  onClick: () => void;
}

function EldarLogo({ onClick }: EldarLogoProps): JSX.Element {
  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-3"
      onClick={onClick}
    >
      <div className="relative h-10 w-10 overflow-hidden">
        <Image
          src={ELDAR_BRAND_LOGO}
          alt="ELDAR logo"
          fill
          sizes="40px"
          className="object-contain"
          priority
        />
      </div>
    </button>
  );
}

interface NavigationBarProps {
  view: ViewMode;
  loading: boolean;
  profileOpen: boolean;
  menuContext: "home" | "sectors";
  headerVisible: boolean;
  showFadeTransition: boolean;
  defaultSearchValue: string;
  onHome: () => void;
  onOpenSectors: () => void;
  onOpenMacro: () => void;
  onPortfolio: () => void;
  onWatchlist: () => void;
  onQuickSearch: (value: string) => void;
}

function NavigationBar({
  view,
  loading,
  profileOpen,
  menuContext,
  headerVisible,
  showFadeTransition,
  defaultSearchValue,
  onHome,
  onOpenSectors,
  onOpenMacro,
  onPortfolio,
  onWatchlist,
  onQuickSearch
}: NavigationBarProps): JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const MenuIcon = menuContext === "sectors" ? Grid2x2 : Home;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav
      className={clsx(
        "fixed left-0 right-0 top-0 z-50 border-b border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        showFadeTransition
          ? headerVisible
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
          : "pointer-events-auto translate-y-0 opacity-100"
      )}
    >
      <div className="container mx-auto px-6">
        <div className="flex h-16 items-center justify-between gap-3">
          <EldarLogo onClick={onHome} />
          <NewsTickerBar />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onQuickSearch(defaultSearchValue)}
              title="Search"
              aria-label="Search"
              className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border text-slate-900 transition-all backdrop-blur-xl"
            >
              <Search className="h-4 w-4" />
            </button>
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen((prev) => !prev)}
                title="Menu"
                aria-label="Menu"
                className={clsx(
                  "flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold transition-all backdrop-blur-xl",
                  isMenuOpen ? "eldar-btn-ghost border-white/60 bg-white/10 text-white" : "eldar-btn-silver text-slate-900"
                )}
              >
                <MenuIcon className="h-4 w-4" />
              </button>
              {isMenuOpen ? (
                <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-2xl border border-white/20 bg-zinc-950/90 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-2xl">
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onHome();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                  >
                    <Home className="h-4 w-4" />
                    Home
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenSectors();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                  >
                    <Grid2x2 className="h-4 w-4" />
                    Sectors
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenMacro();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                  >
                    <LineChart className="h-4 w-4" />
                    Macro
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onPortfolio();
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
              onClick={onWatchlist}
              title="Watchlist"
              aria-label="Watchlist"
              className={clsx(
                "relative flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold transition-all backdrop-blur-xl",
                view === "watchlist" ? "eldar-btn-ghost border-white/60 bg-white/10 text-white" : "eldar-btn-silver text-slate-900"
              )}
            >
              <Bookmark className="h-4 w-4" />
            </button>
            <SignedOut>
              <SignInButton mode="modal">
                <button
                  title="Profile"
                  aria-label="Profile"
                  className={clsx(
                    "flex h-11 w-11 items-center justify-center rounded-2xl border p-0 text-sm font-semibold transition-all backdrop-blur-xl",
                    profileOpen ? "eldar-btn-ghost border-white/60 bg-white/10 text-white" : "eldar-btn-silver text-slate-900"
                  )}
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
        {loading ? (
          <div className="relative h-[2px] w-full overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 w-1/3 animate-[eldar-request-sheen_900ms_linear_infinite] rounded-full bg-gradient-to-r from-transparent via-zinc-100/90 to-transparent" />
          </div>
        ) : null}
      </div>
    </nav>
  );
}

interface BottomPanelProps {
  marketOpen: boolean;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
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

function BottomPanel({ marketOpen, themeMode, onToggleTheme }: BottomPanelProps): JSX.Element {
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl">
      <div className="container mx-auto px-6">
        <div className="flex h-10 items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="eldar-status-star eldar-status-live" />
          <span className="eldar-caption text-[9px] text-white/50">LIVE | {marketOpen ? "Market Open" : "Market Closed"}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
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
  );
}

interface AnalysisRadarOverlayProps {
  symbol: string | null;
  phase: AnalysisPhase;
}

function AnalysisRadarOverlay({ symbol, phase }: AnalysisRadarOverlayProps): JSX.Element {
  return (
    <div className="eldar-radar-overlay fixed inset-0 z-[80] flex items-center justify-center px-6">
      <div className="eldar-radar-panel rounded-3xl border border-white/20 px-8 py-7 text-center backdrop-blur-xl">
        <div className="eldar-radar mx-auto mb-5" aria-hidden="true">
          <span className="eldar-radar-ring eldar-radar-ring-1" />
          <span className="eldar-radar-ring eldar-radar-ring-2" />
          <span className="eldar-radar-ring eldar-radar-ring-3" />
          <span className="eldar-radar-sweep" />
          <span className="eldar-radar-core" />
        </div>
        <p className="eldar-caption text-[10px] text-white/65">ANALYZING {symbol ? `$${symbol}` : "SYMBOL"}</p>
        <p className="mt-2 text-sm text-white/82">
          {phase === "fetching" ? "Pulling live market data..." : "Finalizing full analysis..."}
        </p>
      </div>
    </div>
  );
}

function scoreLabel(score: number): string {
  const formatted = Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1);
  return score > 0 ? `+${formatted}` : formatted;
}

function ratingToneByScore(score: number): "bullish" | "neutral" | "bearish" {
  if (score > 6) return "bullish";
  if (score > 4) return "neutral";
  return "bearish";
}

function ratingLabelFromKey(rating: RatingLabel): string {
  return RATING_BANDS[rating].label;
}

function ratingLabelToneClass(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("bullish") || normalized.includes("buy")) return "text-emerald-300";
  if (normalized.includes("bearish") || normalized.includes("sell")) return "text-red-300";
  return "text-slate-300";
}

function percentWithSign(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function sectorHeatFromScore(score: number): "HOT" | "NEUTRAL" | "COLD" {
  if (score >= 7) return "HOT";
  if (score >= 5) return "NEUTRAL";
  return "COLD";
}

function sectorHeatLabel(heat: "HOT" | "NEUTRAL" | "COLD"): string {
  return heat;
}

interface HackingScoreProps {
  value: number;
  triggerKey: string;
  className?: string;
  durationMs?: number;
}

function HackingScore({ value, triggerKey, className, durationMs = 900 }: HackingScoreProps): JSX.Element {
  const [displayValue, setDisplayValue] = useState<number>(value);

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setDisplayValue(0);
      return;
    }

    let rafId = 0;
    const start = performance.now();

    const animate = (now: number): void => {
      const elapsed = now - start;
      if (elapsed >= durationMs) {
        setDisplayValue(value);
        return;
      }

      const progress = elapsed / durationMs;
      const jitter = (1 - progress) * 2.4;
      const noise = (Math.random() - 0.5) * jitter;
      const next = Math.max(0, Math.min(10, value + noise));
      setDisplayValue(next);
      rafId = window.requestAnimationFrame(animate);
    };

    rafId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(rafId);
  }, [value, triggerKey, durationMs]);

  return <span className={className}>{displayValue.toFixed(1)}</span>;
}

function formatOptionalDecimal(value: number | null | undefined, digits = 2): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value.toFixed(digits);
}

function formatEarningsDate(value: string | null): string {
  if (!value) return "TBD";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "TBD";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dedupeSearchResultsBySymbol(results: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  const deduped: SearchResultItem[] = [];

  for (const item of results) {
    if (seen.has(item.symbol)) {
      continue;
    }

    seen.add(item.symbol);
    deduped.push(item);
  }

  return deduped;
}

function sortMag7Cards(cards: Mag7ScoreCard[]): Mag7ScoreCard[] {
  const rank = (value: number | null): number => (typeof value === "number" && Number.isFinite(value) ? value : -Infinity);
  return [...cards].sort(
    (a, b) => rank(b.changePercent) - rank(a.changePercent) || b.score - a.score || a.symbol.localeCompare(b.symbol)
  );
}

function buildSparklinePath(points: number[], width: number, height: number): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M0 ${height / 2} L${width} ${height / 2}`;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 0.000001);

  return points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function areMag7CardsEqual(a: Mag7ScoreCard[], b: Mag7ScoreCard[]): boolean {
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];

    if (left.symbol !== right.symbol || left.rating !== right.rating || Math.abs(left.score - right.score) > 0.001) {
      return false;
    }

    if (Math.abs(left.currentPrice - right.currentPrice) > 0.001) {
      return false;
    }

    const leftChange = left.changePercent ?? null;
    const rightChange = right.changePercent ?? null;
    if (leftChange === null && rightChange === null) {
      continue;
    }

    if (leftChange === null || rightChange === null || Math.abs(leftChange - rightChange) > 0.001) {
      return false;
    }
  }

  return true;
}

export function StockDashboard({
  initialHistory,
  initialWatchlist,
  initialMag7Scores,
  currentUserId
}: StockDashboardProps): JSX.Element {
  const router = useRouter();
  const [isAppOpen, setIsAppOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");
  const [ticker, setTicker] = useState("");
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
  const [resultsContextReady, setResultsContextReady] = useState(true);
  const [marketMovers, setMarketMovers] = useState<MarketMoverItem[]>([]);
  const [marketMoversLoading, setMarketMoversLoading] = useState(false);
  const [indicesYtd, setIndicesYtd] = useState<IndexYtdItem[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [indicesError, setIndicesError] = useState("");
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [upcomingEarnings, setUpcomingEarnings] = useState<UpcomingEarningsItem[]>([]);
  const [passedEarnings, setPassedEarnings] = useState<PassedEarningsItem[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState("");
  const [earningsView, setEarningsView] = useState<"upcoming" | "past">("upcoming");
  const [homeHeaderVisible, setHomeHeaderVisible] = useState(false);
  const [heroScrollY, setHeroScrollY] = useState(0);
  const [showRatingMeaning, setShowRatingMeaning] = useState(false);
  const [isNewsExpanded, setIsNewsExpanded] = useState(false);
  const [portfolioInputTicker, setPortfolioInputTicker] = useState("");
  const [portfolioInputShares, setPortfolioInputShares] = useState("1");
  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHolding[]>([]);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [comparisonSymbols, setComparisonSymbols] = useState<string[]>([]);
  const [comparisonStateBySymbol, setComparisonStateBySymbol] = useState<Record<string, ComparisonState>>({});
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const heroSectionRef = useRef<HTMLDivElement | null>(null);
  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  const paletteCacheRef = useRef<Map<string, SearchResultItem[]>>(new Map());
  const analysisCacheRef = useRef<Map<string, { analysis: PersistedAnalysis; expiresAt: number }>>(new Map());
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisRequestRef = useRef(0);
  const watchlistHintTimeoutRef = useRef<number | null>(null);
  const mouseRafRef = useRef<number | null>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseLastPaintRef = useRef(0);
  const deferredPaletteQuery = useDeferredValue(paletteQuery);
  const appBackground = themeMode === "light" ? "#E9EEF4" : "#111317";
  const portfolioStorageKey = useMemo(
    () => `eldar-portfolio-holdings:${currentUserId ?? "anon"}`,
    [currentUserId]
  );
  const headerVisible = view === "home" ? homeHeaderVisible : true;
  const showFadeTransition = view === "home";
  const heroParallaxOffset = Math.min(heroScrollY * 0.2, 120);

  function closeCommandPalette(): void {
    setIsCommandPaletteOpen(false);
    setPaletteError("");
    setPaletteAction("analyze");
  }

  function closeProfileModal(): void {
    setIsProfileOpen(false);
  }

  function openCommandPalette(prefill?: string, action: PaletteAction = "analyze"): void {
    setPaletteQuery(prefill ?? ticker);
    setPaletteError("");
    setPaletteAction(action);
    setIsProfileOpen(false);
    setIsCommandPaletteOpen(true);
  }

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

  function saveReturnState(): void {
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
  }

  function openSectorsPage(): void {
    saveReturnState();
    router.push("/sectors");
  }

  function openMacroPage(): void {
    saveReturnState();
    router.push("/macro");
  }

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
      };

      if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > 1000 * 60 * 60) {
        return;
      }

      if (typeof parsed.isAppOpen === "boolean") {
        setIsAppOpen(parsed.isAppOpen);
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
    } catch {
      // no-op
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
        .filter((item) => item.symbol && item.shares > 0 && isTop100Sp500Symbol(item.symbol));

      if (restored.length > 0) {
        setPortfolioHoldings(restored);
      }
    } catch {
      // no-op
    }
  }, [portfolioStorageKey]);

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
      setHeroScrollY(0);
      return;
    }

    const onScroll = (): void => {
      const y = window.scrollY;
      const heroHeight = heroSectionRef.current?.offsetHeight ?? 420;
      const threshold = Math.max(220, Math.floor(heroHeight * 0.58));
      setHeroScrollY(y);
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
  }, [isAppOpen, view, currentRating, marketMovers.length, upcomingEarnings.length, passedEarnings.length, watchlist.length]);

  useEffect(() => {
    if (view !== "results") {
      setShowRatingMeaning(false);
      setIsNewsExpanded(false);
      setComparisonOpen(false);
    }
  }, [view, currentRating?.symbol]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!isAppOpen) {
          setIsAppOpen(true);
        }
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

      if (event.key === "Escape" && isProfileOpen) {
        event.preventDefault();
        closeProfileModal();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAppOpen, isCommandPaletteOpen, isProfileOpen, ticker]);

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
    if (!resultsContextReady) return;

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
          idleId = withIdleCallback.requestIdleCallback(finalize, { timeout: 140 });
        } else {
          finalize();
        }
      });
    });

    timeoutId = window.setTimeout(finalize, 650);

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
  }, [analysisPhase, view, currentRating, resultsContextReady]);

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
          passed?: PassedEarningsItem[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load earnings.");
        }

        if (disposed) return;
        const upcoming = Array.isArray(payload.upcoming) ? payload.upcoming : [];
        const passed = Array.isArray(payload.passed) ? payload.passed : [];
        setUpcomingEarnings((prev) => (upcoming.length > 0 ? upcoming : prev));
        setPassedEarnings((prev) => (passed.length > 0 ? passed : prev));
        if (upcoming.length === 0 && passed.length > 0) {
          setEarningsView("past");
        }
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

    if (indicesYtd.length === 0) {
      setIndicesLoading(true);
    }

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
        setIndicesYtd(nextIndices);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load indices.";
        setIndicesError(message);
      } finally {
        setIndicesLoading(false);
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
        const allowed = results.filter((item) => isTop100Sp500Symbol(item.symbol));
        const deduped = dedupeSearchResultsBySymbol(allowed);
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

    if (!isTop100Sp500Symbol(symbol)) {
      throw new Error("ELDAR currently supports Top 100 S&P 500 symbols only.");
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

    if (!isTop100Sp500Symbol(symbol)) {
      setPortfolioError("Portfolio supports Top 100 S&P 500 symbols only.");
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
    if (!isTop100Sp500Symbol(symbol)) {
      setApiError("Comparison supports Top 100 S&P 500 symbols only.");
      return;
    }

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

    if (!isTop100Sp500Symbol(symbol)) {
      setApiError("ELDAR currently supports Top 100 S&P 500 symbols only.");
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
    setResultsContextReady(false);
    setApiError("");

    let movedToRendering = false;

    try {
      const analysis = await fetchAnalysisSnapshot(symbol, { signal: controller.signal });

      if (requestId !== analysisRequestRef.current) {
        return;
      }

      setCurrentRating(analysis);
      setTicker(analysis.symbol);
      setView("results");

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

    closeCommandPalette();
    void analyzeSymbol(item.symbol);
  }

  async function saveToWatchlist(): Promise<void> {
    if (!currentRating) return;

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ symbol: currentRating.symbol })
      });

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
    try {
      const response = await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
        method: "DELETE"
      });

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
        confidence: "Medium" as "High" | "Medium" | "Low",
        keySignals: [] as Array<{ tone: "positive" | "risk"; text: string }>
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

    const factorCount = currentRating.factors.length;
    const confidence = factorCount >= 10 ? "High" : factorCount >= 8 ? "Medium" : "Low";

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

    return {
      topPercentile,
      sectorAverageScore,
      confidence,
      keySignals: keySignals.slice(0, 3)
    };
  }, [currentRating, history, stockContext?.sectorAverageScore]);

  const portfolioSummary = useMemo(() => {
    const completedHoldings = portfolioHoldings.filter((holding) => holding.analysis !== null);
    if (completedHoldings.length === 0) {
      return {
        totalValue: 0,
        weightedScore: 0,
        adjustedScore: 0,
        diversification: "Low" as "High" | "Medium" | "Low",
        healthScore: 0,
        recommendations: ["Add holdings to generate a portfolio health check."],
        sectorBreakdown: [] as Array<{
          sector: string;
          allocationPct: number;
          avgScore: number;
          heat: "HOT" | "NEUTRAL" | "COLD";
        }>,
        lowScoreCount: 0,
        ratingLabel: RATING_BANDS.HOLD.label
      };
    }

    const valuationRows = completedHoldings.map((holding) => {
      const analysis = holding.analysis as PersistedAnalysis;
      const positionValue = holding.shares * Math.max(analysis.currentPrice, 0.01);
      return {
        ...holding,
        analysis,
        positionValue
      };
    });

    const totalValue = valuationRows.reduce((sum, row) => sum + row.positionValue, 0);
    const fallbackTotalShares = valuationRows.reduce((sum, row) => sum + row.shares, 0);
    const denominator = totalValue > 0 ? totalValue : Math.max(fallbackTotalShares, 1);

    const weightedScore = valuationRows.reduce((sum, row) => {
      const weight = (totalValue > 0 ? row.positionValue : row.shares) / denominator;
      return sum + row.analysis.score * weight;
    }, 0);

    const sectorAccumulator = new Map<string, { value: number; weightedScore: number }>();
    for (const row of valuationRows) {
      const sector = row.analysis.sector || "Other";
      const current = sectorAccumulator.get(sector) ?? { value: 0, weightedScore: 0 };
      const allocationValue = totalValue > 0 ? row.positionValue : row.shares;
      current.value += allocationValue;
      current.weightedScore += row.analysis.score * allocationValue;
      sectorAccumulator.set(sector, current);
    }

    const sectorBreakdown = Array.from(sectorAccumulator.entries())
      .map(([sector, values]) => {
        const allocationPct = (values.value / denominator) * 100;
        const avgScore = values.value > 0 ? values.weightedScore / values.value : 0;
        const heat = sectorHeatFromScore(avgScore);
        return {
          sector,
          allocationPct,
          avgScore,
          heat
        };
      })
      .sort((a, b) => b.allocationPct - a.allocationPct);

    const maxSectorPct = sectorBreakdown[0]?.allocationPct ?? 0;
    const hhi = sectorBreakdown.reduce((sum, sector) => sum + (sector.allocationPct / 100) ** 2, 0);
    const lowScoreCount = completedHoldings.filter((holding) => (holding.analysis as PersistedAnalysis).score < 7).length;
    const coldSectorCount = sectorBreakdown.filter((sector) => sector.heat === "COLD").length;

    const concentrationPenalty = Math.max(0, (maxSectorPct - 45) * 0.03) + Math.max(0, (hhi - 0.34) * 4.1);
    const coldPenalty = coldSectorCount * 0.24 + lowScoreCount * 0.18;
    const adjustedScore = Math.max(0, Math.min(10, weightedScore - concentrationPenalty - coldPenalty));

    const diversification =
      sectorBreakdown.length >= 5 && maxSectorPct < 40
        ? "High"
        : sectorBreakdown.length >= 3 && maxSectorPct < 60
          ? "Medium"
          : "Low";

    const diversificationScore = diversification === "High" ? 9 : diversification === "Medium" ? 6.7 : 4.2;
    const healthScore = Math.max(0, Math.min(10, adjustedScore * 0.72 + diversificationScore * 0.28));

    const recommendations: string[] = [];
    if (maxSectorPct > 65) {
      recommendations.push(`High ${sectorBreakdown[0]?.sector ?? "single-sector"} concentration`);
    } else if (maxSectorPct > 50) {
      recommendations.push(`Monitor concentration risk in ${sectorBreakdown[0]?.sector ?? "top sector"}`);
    }

    if (coldSectorCount > 0) {
      recommendations.push(`${coldSectorCount} sector bucket${coldSectorCount > 1 ? "s" : ""} rated COLD`);
    }

    if (lowScoreCount > 0) {
      recommendations.push(`${lowScoreCount} position${lowScoreCount > 1 ? "s" : ""} below 7.0`);
    }

    if (diversification === "Low") {
      recommendations.push("Consider adding defensive/non-correlated sectors");
    } else if (diversification === "Medium") {
      recommendations.push("Diversification is moderate; add one non-tech hedge");
    }

    if (recommendations.length === 0) {
      recommendations.push("Portfolio profile is balanced across holdings and sectors.");
    }

    const portfolioRatingLabel = RATING_BANDS[toRating(adjustedScore)].label;

    return {
      totalValue,
      weightedScore,
      adjustedScore,
      diversification,
      healthScore,
      recommendations: recommendations.slice(0, 4),
      sectorBreakdown,
      lowScoreCount,
      ratingLabel: portfolioRatingLabel
    };
  }, [portfolioHoldings]);

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

  const portfolioAllocationSegments = useMemo(() => {
    if (portfolioAllocation.length === 0) {
      return [] as Array<{
        id: string;
        symbol: string;
        allocationPct: number;
        start: number;
        end: number;
        mid: number;
        color: string;
      }>;
    }

    const segmentPalette = [
      "rgba(226, 232, 240, 0.88)",
      "rgba(167, 243, 208, 0.86)",
      "rgba(186, 230, 253, 0.84)",
      "rgba(254, 205, 211, 0.84)",
      "rgba(252, 211, 77, 0.8)",
      "rgba(196, 181, 253, 0.82)",
      "rgba(153, 246, 228, 0.82)",
      "rgba(251, 207, 232, 0.8)"
    ];

    const sorted = [...portfolioAllocation].sort((a, b) => b.allocationPct - a.allocationPct);
    const visible = sorted.slice(0, 8);
    const restPct = sorted.slice(8).reduce((sum, item) => sum + item.allocationPct, 0);

    const basis = restPct > 0.35
      ? [...visible, { id: "rest", symbol: "REST", allocationPct: restPct }]
      : visible.map((item) => ({ id: item.id, symbol: item.symbol, allocationPct: item.allocationPct }));

    let cursor = 0;
    return basis
      .map((item, index) => {
        const start = cursor;
        const end = Math.min(100, start + item.allocationPct);
        cursor = end;
        return {
          id: item.id,
          symbol: item.symbol,
          allocationPct: item.allocationPct,
          start,
          end,
          mid: (start + end) / 2,
          color: segmentPalette[index % segmentPalette.length]
        };
      })
      .filter((segment) => segment.end - segment.start > 0.2);
  }, [portfolioAllocation]);

  const allocationWheelStyle = useMemo(() => {
    if (portfolioAllocationSegments.length === 0) {
      return {
        background:
          "conic-gradient(from 180deg, rgba(255,255,255,0.18) 0deg, rgba(255,255,255,0.08) 360deg)"
      };
    }

    return {
      background: `conic-gradient(from 180deg, ${portfolioAllocationSegments
        .map((segment) => `${segment.color} ${segment.start.toFixed(2)}% ${segment.end.toFixed(2)}%`)
        .join(", ")})`
    };
  }, [portfolioAllocationSegments]);

  const portfolioWheelLabels = useMemo(() => {
    type WheelLabel = {
      id: string;
      symbol: string;
      allocationPct: number;
      anchorX: number;
      anchorY: number;
      labelX: number;
      labelY: number;
      side: "left" | "right";
    };

    const base = portfolioAllocationSegments
      .filter((segment) => segment.symbol !== "REST" && segment.allocationPct >= 3.5)
      .map((segment) => {
        const angleRad = ((segment.mid / 100) * 360 - 90) * (Math.PI / 180);
        const radialDistance =
          segment.allocationPct >= 16 ? 31 :
            segment.allocationPct >= 10 ? 35 :
              segment.allocationPct >= 6 ? 38 : 41;
        const anchorX = 50 + Math.cos(angleRad) * radialDistance;
        const anchorY = 50 + Math.sin(angleRad) * radialDistance;
        const side: "left" | "right" = Math.cos(angleRad) >= 0 ? "right" : "left";
        const labelX = side === "right"
          ? Math.max(57, Math.min(76, anchorX + 4.5))
          : Math.min(43, Math.max(24, anchorX - 4.5));

        return {
          id: segment.id,
          symbol: segment.symbol,
          allocationPct: segment.allocationPct,
          anchorX,
          anchorY,
          labelX,
          labelY: anchorY,
          side
        } satisfies WheelLabel;
      });

    const spreadVertically = (labels: WheelLabel[]): WheelLabel[] => {
      if (labels.length <= 1) {
        return labels;
      }

      const sorted = [...labels].sort((a, b) => a.labelY - b.labelY);
      const minY = 17;
      const maxY = 83;
      const gap = 5.5;

      sorted[0].labelY = Math.max(minY, Math.min(maxY, sorted[0].labelY));
      for (let index = 1; index < sorted.length; index += 1) {
        const target = Math.max(minY, Math.min(maxY, sorted[index].labelY));
        sorted[index].labelY = Math.max(target, sorted[index - 1].labelY + gap);
      }

      for (let index = sorted.length - 1; index >= 0; index -= 1) {
        sorted[index].labelY = Math.max(minY, Math.min(maxY, sorted[index].labelY));
        if (index < sorted.length - 1 && sorted[index + 1].labelY - sorted[index].labelY < gap) {
          sorted[index].labelY = sorted[index + 1].labelY - gap;
        }
      }

      return sorted;
    };

    const left = spreadVertically(base.filter((item) => item.side === "left"));
    const right = spreadVertically(base.filter((item) => item.side === "right"));

    return [...left, ...right];
  }, [portfolioAllocationSegments]);

  const portfolioAllocationById = useMemo(() => {
    const map = new Map<string, (typeof portfolioAllocation)[number]>();
    for (const item of portfolioAllocation) {
      map.set(item.id, item);
    }
    return map;
  }, [portfolioAllocation]);

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
                      } else {
                        void analyzeSymbol(paletteQuery);
                      }
                    }
                  }
                }}
                placeholder="Ticker or company..."
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
                  title="Clear"
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
                  : "Enter to analyze"}
            </p>
          </div>

          <div className="max-h-[420px] overflow-y-auto overscroll-contain p-2">
            {paletteLoading ? (
              <div className="px-3 py-6 text-center text-sm text-white/60">Loading results...</div>
            ) : null}

            {!paletteLoading && paletteError ? (
              <div className="mx-2 my-2 rounded-xl border border-zinc-400/35 bg-zinc-300/10 px-3 py-2 text-sm text-zinc-100">
                {paletteError}
              </div>
            ) : null}

            {!paletteLoading && !paletteError && paletteQuery.trim() && paletteResults.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-white/55">No matching symbols found.</div>
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
                        {paletteAction === "portfolio-add" ? "Select" : paletteAction === "compare-add" ? "Compare" : "Analyze"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {!paletteQuery.trim() ? (
              <div className="px-3 py-6 text-center text-sm text-white/55">Type a ticker or company name.</div>
            ) : null}
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

  if (!isAppOpen) {
    return (
      <div
        className="relative min-h-screen overflow-hidden bg-black text-white"
        style={{
          background: appBackground
        }}
      >
        <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 pb-10 pt-14">
          <main className="flex flex-1 items-center justify-center">
            <section className="mx-auto max-w-3xl text-center">
              <div className="mb-6 flex justify-center">
                <div className="relative h-40 w-40">
                  <Image src={ELDAR_BRAND_LOGO} alt="ELDAR logo" fill sizes="160px" className="object-contain" priority />
                </div>
              </div>
              <h1 className="eldar-display text-4xl leading-[1.15] text-zinc-100 md:text-6xl">Make Smarter Decisions.</h1>
              <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-zinc-300 md:text-base">
                Institutional-grade multi-factor analysis engine.
              </p>
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsAppOpen(true);
                    setView("home");
                  }}
                  className="eldar-btn-silver rounded-2xl px-8 py-3 text-sm font-bold tracking-wide"
                >
                  Open App
                </button>
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }

  if (view === "home" || (view === "results" && !currentRating)) {
    const displayedUpcomingEarnings = upcomingEarnings.length > 0 ? upcomingEarnings : FALLBACK_UPCOMING_EARNINGS;
    const displayedPassedEarnings = passedEarnings.length > 0 ? passedEarnings : FALLBACK_PASSED_EARNINGS;

    return (
      <div
        className="min-h-screen overflow-x-hidden text-white"
        style={{
          background: appBackground
        }}
      >
        <NavigationBar
          view={view}
          loading={loading}
          profileOpen={isProfileOpen}
          menuContext="home"
          headerVisible={headerVisible}
          showFadeTransition={showFadeTransition}
          defaultSearchValue={ticker}
          onHome={goHomeView}
          onOpenSectors={openSectorsPage}
          onOpenMacro={openMacroPage}
          onPortfolio={() => setView("portfolio")}
          onWatchlist={() => setView("watchlist")}
          onQuickSearch={(value) => openCommandPalette(value)}
        />
        <div className="container mx-auto px-6 pb-32 pt-36">
          <div ref={heroSectionRef} className="mx-auto max-w-4xl text-center">
            <div className="reveal-block mb-8 flex justify-center" style={{ transform: `translate3d(0, ${-heroParallaxOffset}px, 0)` }}>
              <div className="relative h-28 w-28 md:h-36 md:w-36">
                <Image src={ELDAR_BRAND_LOGO} alt="ELDAR logo" fill sizes="144px" className="object-contain" priority />
              </div>
            </div>
            <div className="reveal-block mx-auto mb-20 max-w-2xl" style={{ transitionDelay: "80ms" }}>
              <button
                type="button"
                onClick={() => openCommandPalette(ticker)}
                disabled={loading}
                className="eldar-btn-silver flex h-16 w-full items-center justify-between rounded-3xl px-6 text-left text-base font-semibold backdrop-blur-xl transition-all duration-300 hover:scale-[1.01]"
              >
                <span className="flex items-center gap-3 text-slate-900">
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                  {loading ? `Analyzing ${ticker || "symbol"}...` : ticker ? ticker : "Ticker or company..."}
                </span>
                <span className="rounded-md border border-black/20 bg-black/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-700">
                  ⌘/Ctrl+K
                </span>
              </button>

              {apiError ? (
                <div className="mt-4 rounded-2xl border border-zinc-400/35 bg-zinc-300/10 p-4 backdrop-blur-xl">
                  <p className="text-sm text-zinc-100">{apiError}</p>
                </div>
              ) : null}
            </div>

            <div className="reveal-block mb-20" style={{ transitionDelay: "140ms" }}>
              <p className="eldar-caption mb-6 text-xs text-white/50">MAG 7</p>
              <div className="mx-auto max-w-6xl overflow-x-auto">
                <div className="mx-auto flex w-max min-w-full flex-nowrap items-center justify-center gap-2 px-1">
                {(mag7Cards.length > 0 ? mag7Cards : POPULAR_STOCKS.map((symbol) => ({
                  symbol,
                  companyName: symbol,
                  score: 0,
                  rating: "HOLD" as RatingLabel,
                  currentPrice: 0,
                  changePercent: null,
                  updatedAt: new Date(0).toISOString()
                }))).map((item, index) => {
                  return (
                    <button
                      key={item.symbol}
                      onClick={() => {
                        setTicker(item.symbol);
                        void analyzeSymbol(item.symbol);
                      }}
                      className={clsx(
                        "group relative w-[88px] overflow-hidden rounded-lg border border-white/25 bg-zinc-900/45 px-2 py-1.5 text-left backdrop-blur-xl transition-all duration-300 hover:border-white/40 hover:bg-zinc-900/65 hover:shadow-lg",
                        pendingSymbol === item.symbol && loading && "eldar-processing"
                      )}
                      style={{ transitionDelay: `${Math.min(index, 6) * 100}ms` }}
                    >
                      <p className="font-mono text-xs font-bold tracking-wide text-white">{item.symbol}</p>
                      <p
                        className={clsx(
                          "mt-0.5 text-[10px] font-semibold",
                          typeof item.changePercent === "number" && item.changePercent > 0 && "text-emerald-300",
                          typeof item.changePercent === "number" && item.changePercent < 0 && "text-red-300",
                          (item.changePercent === null || item.changePercent === 0) && "text-white/70"
                        )}
                      >
                        {typeof item.changePercent === "number"
                          ? `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`
                          : "Change pending"}
                      </p>
                    </button>
                  );
                })}
                </div>
              </div>
            </div>

            <div className="reveal-block mb-16 grid gap-4 md:grid-cols-2 xl:grid-cols-3" style={{ transitionDelay: "200ms" }}>
              <div className="eldar-panel mx-auto flex h-[248px] w-full max-w-sm flex-col rounded-xl p-1.5 text-left sm:h-[258px] md:h-[268px]">
                <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
                  <h3 className="eldar-caption text-[11px] text-white/65">EARNINGS</h3>
                  <div className="inline-flex rounded-lg border border-white/15 bg-zinc-950/40 p-0.5">
                    <button
                      type="button"
                      onClick={() => setEarningsView("upcoming")}
                      className={clsx(
                        "rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition",
                        earningsView === "upcoming" ? "bg-white/20 text-white" : "text-white/60 hover:text-white"
                      )}
                    >
                      Upcoming
                    </button>
                    <button
                      type="button"
                      onClick={() => setEarningsView("past")}
                      className={clsx(
                        "rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition",
                        earningsView === "past" ? "bg-white/20 text-white" : "text-white/60 hover:text-white"
                      )}
                    >
                      Past
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  {earningsView === "upcoming" ? (
                    earningsLoading && displayedUpcomingEarnings.length === 0 ? (
                      <div className="flex h-full items-center">
                        <p className="text-sm text-white/60">Loading upcoming earnings...</p>
                      </div>
                    ) : displayedUpcomingEarnings.length === 0 ? (
                      <div className="flex h-full items-center">
                        <p className="text-xs text-white/60">No upcoming earnings yet.</p>
                      </div>
                    ) : (
                      <div className="h-full space-y-1">
                        {displayedUpcomingEarnings.slice(0, 3).map((item, index) => (
                          <div
                            key={`${item.symbol}-${item.date ?? "na"}`}
                            className="reveal-block min-h-[56px] rounded-md border border-white/15 bg-zinc-950/40 px-2 py-1"
                            style={{ transitionDelay: `${index * 100}ms` }}
                          >
                            <p className="font-mono text-[11px] font-semibold text-white">${item.symbol}</p>
                            <p className="truncate text-[9px] text-white/60">{item.companyName}</p>
                            <p className="mt-0.5 text-[10px] text-white/70">
                              {formatEarningsDate(item.date)}
                              {formatOptionalDecimal(item.epsEstimate, 2) ? ` • Est EPS ${formatOptionalDecimal(item.epsEstimate, 2)}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    )
                  ) : earningsLoading && displayedPassedEarnings.length === 0 ? (
                    <div className="flex h-full items-center">
                      <p className="text-sm text-white/60">Loading past earnings...</p>
                    </div>
                  ) : displayedPassedEarnings.length === 0 ? (
                    <div className="flex h-full items-center">
                      <p className="text-xs text-white/60">No recent earnings yet.</p>
                    </div>
                  ) : (
                    <div className="h-full space-y-1">
                      {displayedPassedEarnings.slice(0, 3).map((item, index) => (
                        <div
                          key={`${item.symbol}-${item.date ?? item.period ?? "na"}`}
                          className="reveal-block min-h-[56px] rounded-md border border-white/15 bg-zinc-950/40 px-2 py-1"
                          style={{ transitionDelay: `${index * 100}ms` }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-mono text-[11px] font-semibold text-white">${item.symbol}</p>
                            <span
                              className={clsx(
                                "text-[10px] font-bold uppercase tracking-[0.12em]",
                                item.outcome === "beat" && "text-emerald-300",
                                item.outcome === "miss" && "text-red-300",
                                item.outcome === "inline" && "text-amber-300",
                                item.outcome === "unknown" && "text-white/55"
                              )}
                            >
                              {item.outcome === "beat" ? "Beat" : item.outcome === "miss" ? "Failed" : item.outcome === "inline" ? "Inline" : "Pending"}
                            </span>
                          </div>
                          <p className="truncate text-[9px] text-white/60">{item.companyName}</p>
                          <p className="mt-0.5 text-[10px] text-white/70">
                            {formatEarningsDate(item.date ?? item.period)}
                            {formatOptionalDecimal(item.actual, 2) ? ` • Act ${formatOptionalDecimal(item.actual, 2)}` : ""}
                            {formatOptionalDecimal(item.estimate, 2) ? ` • Est ${formatOptionalDecimal(item.estimate, 2)}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {earningsError ? <p className="mt-1 truncate text-[10px] text-zinc-200/80">{earningsError}</p> : null}
              </div>

              <div className="eldar-panel mx-auto flex h-[248px] w-full max-w-sm flex-col rounded-xl p-1.5 text-left sm:h-[258px] md:h-[268px]">
                <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
                  <h3 className="eldar-caption whitespace-nowrap text-[11px] text-white/65">MARKET MOVERS</h3>
                  <span aria-hidden="true" className="h-7 w-[156px] rounded-lg border border-transparent opacity-0" />
                </div>
                <div className="flex-1 overflow-hidden">
                  {marketMoversLoading && marketMovers.length === 0 ? (
                    <div className="flex h-full items-center">
                      <p className="text-xs text-white/60">Loading movers...</p>
                    </div>
                  ) : marketMovers.length === 0 ? (
                    <div className="flex h-full items-center">
                      <p className="text-xs text-white/60">No movers available.</p>
                    </div>
                  ) : (
                    <div className="h-full space-y-1">
                      {marketMovers.slice(0, 3).map((item, index) => (
                        <button
                          key={item.symbol}
                          onClick={() => {
                            setTicker(item.symbol);
                            void analyzeSymbol(item.symbol);
                          }}
                          className="reveal-block flex min-h-[56px] w-full items-center justify-between rounded-md border border-white/15 bg-zinc-950/40 px-2 py-1 text-left transition hover:border-white/35"
                          style={{ transitionDelay: `${index * 100}ms` }}
                        >
                          <div>
                            <p className="font-mono text-[11px] font-semibold text-white">${item.symbol}</p>
                            <p className="truncate text-[9px] text-white/60">{item.companyName}</p>
                            <p className="mt-0.5 text-[10px] text-white/70">
                              {typeof item.currentPrice === "number" ? `$${item.currentPrice.toFixed(2)}` : "Price pending"}
                            </p>
                          </div>
                          <p
                            className={clsx(
                              "text-[10px] font-semibold",
                              typeof item.changePercent === "number" && item.changePercent > 0 && "text-emerald-300",
                              typeof item.changePercent === "number" && item.changePercent < 0 && "text-red-300",
                              (item.changePercent === null || item.changePercent === 0) && "text-white/70"
                            )}
                          >
                            {typeof item.changePercent === "number"
                              ? `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`
                              : "Pending"}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="eldar-panel mx-auto flex h-[248px] w-full max-w-sm flex-col rounded-xl p-1.5 text-left sm:h-[258px] md:h-[268px]">
                <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
                  <h3 className="eldar-caption whitespace-nowrap text-[11px] text-white/65">US INDICES (YTD)</h3>
                  <span aria-hidden="true" className="h-7 w-[156px] rounded-lg border border-transparent opacity-0" />
                </div>
                <div className="flex-1 overflow-hidden">
                  {indicesLoading && indicesYtd.length === 0 ? (
                    <div className="flex h-full items-center">
                      <p className="text-xs text-white/60">Loading indices...</p>
                    </div>
                  ) : indicesYtd.length === 0 ? (
                    <div className="flex h-full items-center">
                      <p className="text-xs text-white/60">No index data available.</p>
                    </div>
                  ) : (
                    <div className="h-full space-y-1">
                      {indicesYtd.slice(0, 3).map((item, index) => {
                        const sparklinePath = buildSparklinePath(item.points, 112, 28);
                        return (
                          <div
                            key={item.code}
                            className="reveal-block flex min-h-[56px] items-center justify-between rounded-md border border-white/15 bg-zinc-950/40 px-2 py-1"
                            style={{ transitionDelay: `${index * 100}ms` }}
                          >
                            <div className="min-w-0">
                              <p className="font-mono text-[11px] font-semibold text-white">{item.label}</p>
                              <p className="mt-0.5 text-[10px] text-white/70">
                                {typeof item.current === "number" ? item.current.toFixed(2) : "Pending"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {sparklinePath ? (
                                <svg
                                  width="112"
                                  height="28"
                                  viewBox="0 0 112 28"
                                  className="overflow-visible"
                                  aria-hidden="true"
                                >
                                  <path
                                    d={sparklinePath}
                                    fill="none"
                                    stroke={
                                      typeof item.ytdChangePercent === "number" && item.ytdChangePercent < 0
                                        ? "rgba(252, 165, 165, 0.85)"
                                        : "rgba(167, 243, 208, 0.85)"
                                    }
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              ) : (
                                <span className="text-[10px] text-white/55">No chart</span>
                              )}
                              <p
                                className={clsx(
                                  "text-right text-[10px] font-semibold",
                                  typeof item.ytdChangePercent === "number" && item.ytdChangePercent > 0 && "text-emerald-300",
                                  typeof item.ytdChangePercent === "number" && item.ytdChangePercent < 0 && "text-red-300",
                                  item.ytdChangePercent === null && "text-white/70"
                                )}
                              >
                                {typeof item.ytdChangePercent === "number"
                                  ? `${item.ytdChangePercent > 0 ? "+" : ""}${item.ytdChangePercent.toFixed(2)}%`
                                  : "Pending"}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {indicesError ? <p className="mt-1 truncate text-[10px] text-zinc-200/80">{indicesError}</p> : null}
              </div>
            </div>

          </div>
        </div>
        {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
        {renderCommandPalette()}
        {renderProfileModal()}
        <BottomPanel marketOpen={isMarketOpen} themeMode={themeMode} onToggleTheme={toggleThemeMode} />
      </div>
    );
  }

  if (view === "results" && currentRating) {
    const ratingBand = RATING_BANDS[currentRating.rating];
    const isStrongBullish = currentRating.rating === "STRONG_BUY";
    const isStrongBearish = currentRating.rating === "STRONG_SELL";
    const ratingLabelTone = ratingLabelToneClass(ratingBand.label);
    const isInWatchlist = watchlist.some((item) => item.symbol === currentRating.symbol);

    return (
      <div
        className="min-h-screen text-white"
        style={{
          background: appBackground
        }}
      >
        <NavigationBar
          view={view}
          loading={loading}
          profileOpen={isProfileOpen}
          menuContext="home"
          headerVisible={headerVisible}
          showFadeTransition={showFadeTransition}
          defaultSearchValue={ticker}
          onHome={goHomeView}
          onOpenSectors={openSectorsPage}
          onOpenMacro={openMacroPage}
          onPortfolio={() => setView("portfolio")}
          onWatchlist={() => setView("watchlist")}
          onQuickSearch={(value) => openCommandPalette(value)}
        />
        <div className="container mx-auto px-6 pb-28 pt-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={goHomeView}
                title="New Analysis"
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

            <div className="reveal-block grid gap-6 xl:grid-cols-[2fr_1fr]">
              <div className="space-y-6">
                <div className="eldar-panel reveal-block rounded-3xl p-6">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div>
                      <p className="eldar-caption text-[10px] text-white/50">ELDAR RATING</p>
                      <div className="mt-2 flex items-center gap-3">
                        <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                          {currentRating.companyName}
                        </h1>
                        <button
                          type="button"
                          onClick={() => {
                            if (isInWatchlist) {
                              void removeWatchlistSymbol(currentRating.symbol);
                              return;
                            }
                            void saveToWatchlist();
                          }}
                          title={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                          aria-label={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                          className={clsx(
                            "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-white/70 transition hover:text-white",
                            isInWatchlist && "text-zinc-100"
                          )}
                        >
                          <Bookmark className={clsx("h-4 w-4", isInWatchlist && "fill-current")} />
                        </button>
                        {watchlistAddedSymbol === currentRating.symbol ? (
                          <span className="text-xs font-semibold text-emerald-300">+ added to the list</span>
                        ) : null}
                      </div>
                      <p className="eldar-display mt-2 text-sm text-white/70">${currentRating.symbol}</p>
                      <p className="mt-2 text-sm text-white/60">
                        {currentRating.sector} • {formatPrice(currentRating.currentPrice, currentRating.currency)} • Market Cap {formatMarketCap(currentRating.marketCap)}
                      </p>
                    </div>

                    <div className="min-w-[180px] text-right">
                      <p
                        className={clsx(
                          "text-2xl font-black",
                          isStrongBullish && "text-amber-100",
                          isStrongBearish && "text-red-100",
                          !isStrongBullish && !isStrongBearish && ratingLabelTone
                        )}
                      >
                        {ratingBand.label}
                      </p>
                      <p className="mt-1 text-sm">
                        <HackingScore
                          value={currentRating.score}
                          triggerKey={String(currentRating.id ?? `${currentRating.symbol}:${currentRating.createdAt}`)}
                        />{" "}
                        / 10
                      </p>
                    </div>
                  </div>
                </div>

                <div className="eldar-panel reveal-block rounded-3xl p-6" style={{ transitionDelay: "80ms" }}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-white">[i] What does this mean?</h2>
                    <button
                      type="button"
                      onClick={() => setShowRatingMeaning((prev) => !prev)}
                      className="eldar-btn-ghost flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
                    >
                      <Info className="h-4 w-4" />
                      {showRatingMeaning ? "Hide" : "Explain"}
                    </button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                    <div className="space-y-3 rounded-2xl border border-white/15 bg-zinc-950/45 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-white/55">Performance Context</p>
                      <p className="text-sm text-white/85">
                        {ratingContextSummary.topPercentile !== null
                          ? `Top ${ratingContextSummary.topPercentile}% of analyzed stocks`
                          : "Top-tier within current sample"}
                      </p>
                      <p className="text-sm text-white/80">
                        Above sector average ({(ratingContextSummary.sectorAverageScore ?? currentRating.score).toFixed(1)})
                      </p>
                      <p className="text-sm text-white/80">Confidence: {ratingContextSummary.confidence}</p>
                      {showRatingMeaning ? (
                        <p className="text-xs leading-relaxed text-white/70">
                          ELDAR aggregates macro, sentiment, technicals, fundamentals, valuation, and options flow into a single normalized institutional score.
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <div className="rounded-2xl border border-white/15 bg-zinc-950/45 px-4 py-3">
                        <p className="mb-2 text-xs uppercase tracking-[0.14em] text-white/55">Key Signals</p>
                        <div className="space-y-1.5 text-sm text-white/82">
                          {ratingContextSummary.keySignals.map((signal, index) => (
                            <p key={`signal-${index}`}>
                              <span
                                className={clsx(
                                  "mr-2 text-[11px] font-semibold uppercase tracking-[0.12em]",
                                  signal.tone === "positive" ? "text-emerald-300" : "text-amber-300"
                                )}
                              >
                                {signal.tone === "positive" ? "Positive" : "Risk"}
                              </span>
                              {signal.text}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="space-y-6">
                <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "120ms" }}>
                  <h3 className="eldar-caption mb-3 text-xs text-white/60">SECTOR CONTEXT</h3>
                  {stockContextLoading ? (
                    <p className="text-sm text-white/55">Loading sector context...</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/15 bg-zinc-950/45 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-white/55">
                          {stockContext?.sector ?? currentRating.sector}
                        </p>
                        <p className="mt-2 text-sm text-white/80">
                          ELDAR Sector avg:{" "}
                          {typeof stockContext?.sectorAverageScore === "number"
                            ? stockContext.sectorAverageScore.toFixed(1)
                            : currentRating.score.toFixed(1)}
                        </p>
                        <p className="mt-1 text-sm text-white/80">
                          {currentRating.symbol} vs sector:{" "}
                          {typeof stockContext?.vsSectorPercent === "number"
                            ? `${percentWithSign(stockContext.vsSectorPercent)} ${stockContext.vsSectorPercent >= 0 ? "UP" : "DOWN"}`
                            : "Pending"}
                        </p>
                      </div>
                      {stockContextError ? <p className="text-xs text-zinc-200/80">{stockContextError}</p> : null}
                    </div>
                  )}
                </div>

                <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "180ms" }}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="eldar-caption text-xs text-white/60">RELATED NEWS</h3>
                    <button
                      type="button"
                      onClick={() => setIsNewsExpanded((prev) => !prev)}
                      className="eldar-btn-ghost min-h-[44px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] md:hidden"
                    >
                      {isNewsExpanded ? "Collapse" : "Expand"}
                    </button>
                  </div>
                  <div
                    className={clsx(
                      "space-y-2.5",
                      !isNewsExpanded && "md:max-h-none md:overflow-visible md:pr-0"
                    )}
                  >
                    {stockContextLoading ? (
                      <p className="text-sm text-white/55">Loading recent news...</p>
                    ) : (stockContext?.news?.length ?? 0) === 0 ? (
                      <p className="text-sm text-white/60">No recent headlines available.</p>
                    ) : (
                      (stockContext?.news ?? []).slice(0, 4).map((item, index) => (
                        <a
                          key={`${item.headline}-${index}`}
                          href={item.url ?? `https://finance.yahoo.com/quote/${encodeURIComponent(currentRating.symbol)}/news`}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2 text-xs text-white/80 transition hover:border-white/30 hover:bg-zinc-900/60 hover:text-white"
                        >
                          <span className="text-white/95">- {item.headline}</span>
                        </a>
                      ))
                    )}
                    <a
                      href={`https://finance.yahoo.com/quote/${encodeURIComponent(currentRating.symbol)}/news`}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-full rounded-xl border border-white/20 bg-white/[0.04] px-3 py-2 text-left text-xs text-white/80 transition hover:border-white/35 hover:bg-white/[0.08]"
                    >
                      View all →
                    </a>
                  </div>
                </div>

                <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "240ms" }}>
                  <div className="mb-3 flex items-center">
                    <h3 className="eldar-caption text-xs text-white/60">SIMILAR STOCKS</h3>
                  </div>

                  <div
                    className={clsx(
                      "gap-2.5",
                      "flex overflow-x-auto pb-1 md:block md:space-y-2.5 md:overflow-visible"
                    )}
                  >
                    {stockContextLoading ? (
                      <p className="text-sm text-white/55">Loading similar stocks...</p>
                    ) : (stockContext?.similarStocks?.length ?? 0) === 0 ? (
                      <p className="text-sm text-white/60">No same-sector stocks available.</p>
                    ) : (
                      (stockContext?.similarStocks ?? []).slice(0, 3).map((item) => (
                        <div
                          key={item.symbol}
                          className="flex min-h-[44px] min-w-[240px] items-center gap-2 rounded-2xl border border-white/20 bg-zinc-950/50 px-3 py-2.5 md:min-w-0"
                        >
                          <button
                            onClick={() => {
                              setTicker(item.symbol);
                              void analyzeSymbol(item.symbol);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate font-mono text-sm font-bold text-white">{item.symbol}</p>
                            <p className="truncate text-[11px] text-white/55">{item.companyName}</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void addComparisonSymbol(item.symbol);
                            }}
                            className="eldar-btn-ghost min-h-[36px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
                          >
                            Compare
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  {comparisonOpen ? (
                    <div className="mt-4 rounded-2xl border border-white/15 bg-zinc-950/45 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-white/60">Compare Stocks</p>
                          <p className="mt-1 font-mono text-xs text-white/75">{comparisonEntries.map((entry) => entry.symbol).join(" vs ")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setComparisonOpen(false)}
                            className="eldar-btn-ghost min-h-[36px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
                          >
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-white/60">ELDAR Rating</p>
                          <div className="space-y-2">
                            {comparisonEntries.map((entry, index) => {
                              const winnerScore = Math.max(...comparisonEntries.map((item) => item.score));
                              const isWinner = entry.score >= winnerScore;
                              return (
                                <div key={`cmp-rating-${entry.symbol}`} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                                  <div className="mb-1 flex items-center justify-between text-xs text-white/80">
                                    <span className={clsx("font-mono", isWinner && "text-zinc-100")}>{entry.symbol}</span>
                                    <span>{entry.loading ? "Loading..." : entry.score.toFixed(1)}</span>
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                    <div
                                      className={clsx(
                                        "h-full rounded-full transition-all duration-[500ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                                        isWinner ? "bg-zinc-100/80" : "bg-zinc-300/45"
                                      )}
                                      style={{
                                        width: `${Math.max(4, Math.min(100, (entry.score / 10) * 100))}%`,
                                        transitionDelay: `${index * 100}ms`
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-white/60">Sector Performance</p>
                          <div className="space-y-2">
                            {comparisonEntries.map((entry, index) => {
                              const winnerSector = Math.max(...comparisonEntries.map((item) => item.sectorScore));
                              const isWinner = entry.sectorScore >= winnerSector;
                              return (
                                <div key={`cmp-sector-${entry.symbol}`} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                                  <div className="mb-1 flex items-center justify-between text-xs text-white/80">
                                    <span className={clsx("font-mono", isWinner && "text-zinc-100")}>{entry.symbol}</span>
                                    <span>{entry.sectorScore.toFixed(1)} ({sectorHeatLabel(entry.heat)})</span>
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                    <div
                                      className={clsx(
                                        "h-full rounded-full transition-all duration-[500ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                                        isWinner ? "bg-zinc-100/80" : "bg-zinc-300/45"
                                      )}
                                      style={{
                                        width: `${Math.max(4, Math.min(100, (entry.sectorScore / 10) * 100))}%`,
                                        transitionDelay: `${index * 100}ms`
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-white/60">Rating</p>
                          <div className="space-y-1">
                            {comparisonEntries.map((entry) => (
                              <p key={`cmp-label-${entry.symbol}`} className="text-xs text-white/80">
                                <span>{entry.symbol}: </span>
                                <span className={clsx(!entry.loading && ratingLabelToneClass(entry.ratingLabel))}>
                                  {entry.loading ? "Loading..." : entry.ratingLabel}
                                </span>
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>
          </div>
        </div>
        {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
        {renderCommandPalette()}
        {renderProfileModal()}
        <BottomPanel marketOpen={isMarketOpen} themeMode={themeMode} onToggleTheme={toggleThemeMode} />
      </div>
    );
  }

  if (view === "portfolio") {
    return (
      <div className="min-h-screen text-white" style={{ background: appBackground }}>
        <NavigationBar
          view={view}
          loading={loading || portfolioLoading}
          profileOpen={isProfileOpen}
          menuContext="home"
          headerVisible={headerVisible}
          showFadeTransition={showFadeTransition}
          defaultSearchValue={ticker}
          onHome={goHomeView}
          onOpenSectors={openSectorsPage}
          onOpenMacro={openMacroPage}
          onPortfolio={() => setView("portfolio")}
          onWatchlist={() => setView("watchlist")}
          onQuickSearch={(value) => openCommandPalette(value, "portfolio-add")}
        />
        <div className="container mx-auto px-6 pb-28 pt-24">
          <div className="mx-auto max-w-6xl">
            <div className="eldar-panel reveal-block rounded-3xl p-6">
              <div className="mb-6">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">PORTFOLIO HEALTH CHECKER</h1>
                  <p className="mt-2 text-sm text-white/70">Build and evaluate your holdings with a weighted ELDAR portfolio score.</p>
                </div>
              </div>

              <div className="mb-6">
                <p className="mb-2 text-sm text-white/75">Add Your Stocks:</p>
                <form
                  className="grid gap-2 rounded-2xl border border-white/15 bg-zinc-950/40 p-3 sm:grid-cols-[minmax(0,1fr)_86px_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addPortfolioHolding();
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openCommandPalette(portfolioInputTicker || "", "portfolio-add")}
                    className="eldar-btn-silver flex min-h-[44px] items-center justify-between rounded-xl px-4 text-left text-sm font-semibold backdrop-blur-xl transition-all duration-300 hover:scale-[1.01]"
                  >
                    <span className="flex items-center gap-2 text-slate-900">
                      <Search className="h-4 w-4" />
                      {portfolioInputTicker ? portfolioInputTicker : "Ticker or company..."}
                    </span>
                    <span className="rounded-md border border-black/20 bg-black/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-700">
                      ⌘K
                    </span>
                  </button>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={portfolioInputShares}
                    onChange={(event) => setPortfolioInputShares(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="Quantity"
                    className="min-h-[44px] w-full rounded-xl border border-white/20 bg-white/5 px-2 py-2 text-center text-sm text-white outline-none placeholder:text-white/45"
                  />
                  <button
                    type="submit"
                    className="eldar-btn-silver flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </form>
                {portfolioError ? (
                  <p className="mt-2 text-xs text-zinc-200/85">{portfolioError}</p>
                ) : null}
              </div>

              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-white">Your Portfolio</h2>
                {portfolioHoldings.length === 0 ? (
                  <div className="rounded-2xl border border-white/15 bg-zinc-950/45 px-4 py-4 text-sm text-white/70">
                    Add positions to start the health check.
                  </div>
                ) : (
                  <div className="grid gap-5 xl:grid-cols-[560px_1fr]">
                    <div className="mx-auto flex justify-center">
                      <div className="relative h-[560px] w-[560px] max-w-full rounded-full border border-white/25 p-4" style={allocationWheelStyle}>
                        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
                          {portfolioWheelLabels.map((label) => (
                            <g key={`wheel-link-${label.id}`}>
                              <line
                                x1={label.anchorX}
                                y1={label.anchorY}
                                x2={label.labelX}
                                y2={label.labelY}
                                stroke="rgba(255,255,255,0.34)"
                                strokeWidth="0.22"
                                strokeLinecap="round"
                              />
                              <circle cx={label.anchorX} cy={label.anchorY} r="0.45" fill="rgba(255,255,255,0.75)" />
                            </g>
                          ))}
                        </svg>

                        {portfolioWheelLabels.map((label) => (
                          <div
                            key={`seg-label-${label.id}`}
                            className="absolute z-10 pointer-events-none select-none rounded-full border border-white/30 bg-black/55 px-2.5 py-1 text-[10px] leading-none tracking-[0.1em] text-white/95 shadow-[0_4px_16px_rgba(0,0,0,0.42)] backdrop-blur-md"
                            style={{
                              left: `${label.labelX}%`,
                              top: `${label.labelY}%`,
                              transform: label.side === "right" ? "translate(0, -50%)" : "translate(-100%, -50%)"
                            }}
                          >
                            <span className="font-mono font-bold">${label.symbol}</span>
                            <span className="ml-1.5 text-[9px] font-semibold text-white/75">{label.allocationPct.toFixed(0)}%</span>
                          </div>
                        ))}

                        <div className="absolute inset-[24%] flex flex-col items-center justify-center rounded-full border border-white/20 bg-black/55 text-center">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-white/60">ELDAR</p>
                          <p className="mt-1 text-3xl font-black text-white">{portfolioSummary.adjustedScore.toFixed(1)}</p>
                          <p className={clsx("mt-1 text-sm font-bold", ratingLabelToneClass(portfolioSummary.ratingLabel))}>
                            {portfolioSummary.ratingLabel}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/15 bg-zinc-950/45 p-4 text-sm text-white/82">
                      <p className="text-xs uppercase tracking-[0.14em] text-white/60">Circle Summary</p>
                      <div className="mt-3 space-y-1.5">
                        <p>Health: {portfolioSummary.healthScore.toFixed(1)} / 10</p>
                        <p>Diversification: {portfolioSummary.diversification}</p>
                        <p>Total Value: {formatPrice(portfolioSummary.totalValue, currentRating?.currency ?? "USD")}</p>
                      </div>

                      <div className="mt-4 space-y-1.5">
                        <p className="text-xs uppercase tracking-[0.14em] text-white/60">Top Sectors</p>
                        {portfolioSummary.sectorBreakdown.slice(0, 3).map((sector) => (
                          <p key={`sector-${sector.sector}`}>
                            {sector.sector}: {sector.allocationPct.toFixed(0)}%
                          </p>
                        ))}
                      </div>

                      <div className="mt-4 space-y-2">
                        <p className="text-xs uppercase tracking-[0.14em] text-white/60">Holdings</p>
                        {portfolioHoldings.map((holding) => {
                          const analysis = holding.analysis;
                          const alloc = portfolioAllocationById.get(holding.id);
                          return (
                            <div key={`summary-${holding.id}`} className="rounded-lg border border-white/12 bg-black/15 px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-white">{holding.symbol}</span>
                                <span>{alloc ? `${alloc.allocationPct.toFixed(1)}%` : "Pending"}</span>
                              </div>
                              <p className="mt-1 text-white/70">
                                {analysis ? formatPrice(analysis.currentPrice, analysis.currency) : "Pending"} • Qty {holding.shares}
                              </p>
                              <div className="mt-1 flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void refreshPortfolioHolding(holding.symbol);
                                  }}
                                  className="text-[10px] uppercase tracking-[0.12em] text-white/70 hover:text-white"
                                >
                                  Refresh
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePortfolioHolding(holding.id)}
                                  className="text-[10px] uppercase tracking-[0.12em] text-white/70 hover:text-white"
                                >
                                  Remove
                                </button>
                              </div>
                              {holding.error ? <p className="mt-1 text-zinc-200/85">{holding.error}</p> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {analysisPhase !== "idle" ? <AnalysisRadarOverlay symbol={(pendingSymbol ?? ticker) || null} phase={analysisPhase} /> : null}
        {renderCommandPalette()}
        {renderProfileModal()}
        <BottomPanel marketOpen={isMarketOpen} themeMode={themeMode} onToggleTheme={toggleThemeMode} />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={{ background: appBackground }}>
      <NavigationBar
        view={view}
        loading={loading}
        profileOpen={isProfileOpen}
        menuContext="home"
        headerVisible={headerVisible}
        showFadeTransition={showFadeTransition}
        defaultSearchValue={ticker}
        onHome={goHomeView}
        onOpenSectors={openSectorsPage}
        onOpenMacro={openMacroPage}
        onPortfolio={() => setView("portfolio")}
        onWatchlist={() => setView("watchlist")}
        onQuickSearch={(value) => openCommandPalette(value)}
      />
      <div className="container mx-auto px-6 pb-28 pt-24">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-8 text-4xl font-black tracking-tight">Watchlist</h1>
          {watchlist.length === 0 ? (
            <div className="eldar-panel rounded-3xl p-8 text-white/70">
              No watchlist symbols yet.
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {watchlist.map((item, index) => {
                const score = item.latest?.score ?? 0;
                const tone = ratingToneByScore(score);

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
                        title="Open Analysis"
                        aria-label="Open Analysis"
                        className="font-mono text-xl font-bold text-white transition hover:text-zinc-200"
                      >
                        {item.symbol}
                      </button>
                      <button
                        onClick={() => {
                          void removeWatchlistSymbol(item.symbol);
                        }}
                        title="Remove"
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
      {renderProfileModal()}
      <BottomPanel marketOpen={isMarketOpen} themeMode={themeMode} onToggleTheme={toggleThemeMode} />
    </div>
  );
}
