"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  BriefcaseBusiness,
  Grid2x2,
  LayoutDashboard,
  LineChart,
  BookText,
  FileText,
  Loader2,
  Mail,
  Moon,
  Plus,
  Search,
  Share2,
  Sun,
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
import { DriversList, SignalHero } from "@/components/ui/AnalysisPrimitives";
import {
  MacroEnvironmentCard,
  MarketNewsPanel,
  MarketMoverStack,
  SectorRotationBoard,
  SnapshotTile
} from "@/components/dashboard/HomeDashboardModules";
import { HeroLanding } from "@/components/landing/HeroLanding";
import { RATING_BANDS, toRating } from "@/lib/rating";
import { scorePortfolio } from "@/lib/scoring/portfolio-engine";
import type { PersistedPortfolioSnapshot, PortfolioEngineInput, PortfolioInputHolding } from "@/lib/scoring/portfolio-types";
import {
  SOCKET_EVENTS,
  type EarningsPayload,
  type IndicesYtdPayload,
  type Mag7Payload,
  type MarketMoversPayload,
  type WatchlistDeltaPayload
} from "@/lib/realtime/events";
import type { FactorResult, Mag7ScoreCard, PersistedAnalysis, RatingLabel, WatchlistItem } from "@/lib/types";
import { formatMarketCap, formatPrice } from "@/lib/utils";
import type {
  HomeDashboardPayload,
  SectorRotationWindow
} from "@/lib/home/dashboard-types";
import { getTop100Sp500Symbols, isTop100Sp500Symbol } from "@/lib/market/top100";
import { exportCard } from "@/lib/share/export-card";
import { DASHBOARD_RETURN_STATE_KEY } from "@/lib/ui/dashboard-intent";
import { isPaletteOpenShortcut } from "@/lib/ui/command-palette";
import { pushRecentTicker } from "@/lib/ui/recent-tickers";
import { useSocket } from "@/hooks/useSocket";

type ViewMode = "home" | "results" | "watchlist" | "portfolio";
type ThemeMode = "dark" | "light";
type AuthMode = "login" | "signup";
type AnalysisPhase = "idle" | "fetching" | "rendering";
type PaletteAction = "analyze" | "portfolio-add" | "compare-add" | "watchlist-add";
type PriceRange = "1W" | "1M" | "3M" | "1Y";

interface StockDashboardProps {
  initialHistory: PersistedAnalysis[];
  initialWatchlist: WatchlistItem[];
  initialMag7Scores: Mag7ScoreCard[];
  currentUserId: string | null;
  initialSymbol?: string | null;
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

interface JournalRelatedEntry {
  id: string;
  ticker: string;
  thesis: string;
  status: "PLANNING" | "OPEN" | "CLOSED";
  createdAt: string;
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

interface HomeTickerDrawerState {
  source: "earnings" | "movers";
  symbol: string;
  companyName: string;
  date: string | null;
  epsEstimate: number | null;
  currentPrice: number | null;
  changePercent: number | null;
}

interface PriceHistoryPoint {
  time: string;
  price: number;
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
const FALLBACK_INDICES_YTD: IndexYtdItem[] = [
  { code: "US30", label: "US30", symbol: "^DJI", current: null, ytdChangePercent: null, asOf: null, points: [] },
  { code: "US100", label: "US100", symbol: "^NDX", current: null, ytdChangePercent: null, asOf: null, points: [] },
  { code: "US500", label: "US500", symbol: "^GSPC", current: null, ytdChangePercent: null, asOf: null, points: [] }
];
const TOP_100_SYMBOLS = getTop100Sp500Symbols();
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
const LOCAL_HOME_DASHBOARD_STORAGE_PREFIX = "eldar:home:dashboard";

interface EldarLogoProps {
  onClick: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function homeDashboardStorageKey(windowKey: SectorRotationWindow): string {
  return `${LOCAL_HOME_DASHBOARD_STORAGE_PREFIX}:${windowKey}`;
}

function readCachedHomeDashboard(windowKey: SectorRotationWindow): HomeDashboardPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(homeDashboardStorageKey(windowKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload?: HomeDashboardPayload };
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function writeCachedHomeDashboard(payload: HomeDashboardPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      homeDashboardStorageKey(payload.sectorWindow),
      JSON.stringify({ storedAt: Date.now(), payload })
    );
  } catch {
    // Session storage writes are optional.
  }
}

function EldarLogo({ onClick }: EldarLogoProps): JSX.Element {
  return (
    <button
      type="button"
      className="eldar-logo-button flex cursor-pointer items-center gap-3"
      onClick={onClick}
    >
      <div className="relative h-[60px] w-[60px] overflow-hidden">
        <Image
          src={ELDAR_BRAND_LOGO}
          alt="ELDAR logo"
          fill
          sizes="60px"
          className="object-contain"
          priority
        />
      </div>
    </button>
  );
}

interface NavigationBarProps {
  view: ViewMode;
  themeMode: ThemeMode;
  loading: boolean;
  marketOpen: boolean;
  profileOpen: boolean;
  menuContext: "home" | "sectors";
  headerVisible: boolean;
  showFadeTransition: boolean;
  defaultSearchValue: string;
  onToggleTheme: () => void;
  onHome: () => void;
  onOpenSectors: () => void;
  onOpenMacro: () => void;
  onOpenJournal: () => void;
  onPortfolio: () => void;
  onQuickSearch: (value: string) => void;
}

function NavigationBar({
  view,
  themeMode,
  loading,
  marketOpen,
  profileOpen,
  menuContext,
  headerVisible,
  showFadeTransition,
  defaultSearchValue,
  onToggleTheme,
  onHome,
  onOpenSectors,
  onOpenMacro,
  onOpenJournal,
  onPortfolio,
  onQuickSearch
}: NavigationBarProps): JSX.Element {
  void headerVisible;
  void showFadeTransition;

  return (
    <aside
      className={clsx(
        "eldar-sidebar-liquid fixed bottom-0 left-0 top-0 z-50 w-[84px] transition-all duration-[220ms] ease-out",
        "pointer-events-auto translate-y-0 opacity-100"
      )}
    >
      <div className="flex h-full flex-col items-center justify-between px-1 pb-4 pt-6">
        <div className="flex w-full flex-col items-center gap-3">
          <EldarLogo onClick={onHome} />
          <div className="flex flex-col items-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => onQuickSearch(defaultSearchValue)}
              aria-label="Search"
              className="eldar-nav-icon text-white/75 transition-colors hover:text-white flex h-11 w-11 items-center justify-center"
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onHome}
              aria-label="Dashboard"
              className={clsx(
                "eldar-nav-icon text-white/75 transition-colors hover:text-white flex h-11 w-11 items-center justify-center text-sm font-semibold",
                view === "home" ? "text-white" : "text-white/75"
              )}
            >
              <LayoutDashboard className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onOpenSectors}
              aria-label="Sectors"
              className="eldar-nav-icon text-white/75 transition-colors hover:text-white flex h-11 w-11 items-center justify-center text-sm font-semibold"
            >
              <Grid2x2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onOpenMacro}
              aria-label="Macro"
              className="eldar-nav-icon text-white/75 transition-colors hover:text-white flex h-11 w-11 items-center justify-center text-sm font-semibold"
            >
              <LineChart className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onOpenJournal}
              aria-label="Journal"
              className="eldar-nav-icon text-white/75 transition-colors hover:text-white flex h-11 w-11 items-center justify-center text-sm font-semibold"
            >
              <BookText className="h-4 w-4" />
            </button>
            <button
              onClick={onPortfolio}
              aria-label="Portfolio"
              className="eldar-nav-icon text-white/75 transition-colors hover:text-white flex h-11 w-11 items-center justify-center text-sm font-semibold"
            >
              <BriefcaseBusiness className="h-4 w-4" />
            </button>
          </div>
          {loading ? (
            <div className="mt-2 flex flex-col items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/90" />
              <span className="h-6 w-[2px] animate-[eldar-request-sheen_900ms_linear_infinite] bg-gradient-to-b from-transparent via-white to-transparent" />
            </div>
          ) : null}
        </div>

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onToggleTheme}
            className={clsx(
              "eldar-menu-icon p-1.5 text-white/75 transition hover:text-white",
              themeMode === "dark"
                ? "text-white"
                : "bg-transparent text-white/85"
            )}
            aria-label="Toggle theme"
          >
            {themeMode === "dark" ? <Sun className="eldar-theme-glyph h-3.5 w-3.5" /> : <Moon className="eldar-theme-glyph h-3.5 w-3.5" />}
          </button>
          <a
            href="https://x.com/ELDAR_AI?s=20"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="X"
          >
            <XBrandIcon />
          </a>
          <a
            href="https://t.me"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="Telegram"
          >
            <TelegramBrandIcon />
          </a>
          <a
            href="https://eldarfrequency.substack.com"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="Substack"
          >
            <FileText className="h-3.5 w-3.5" />
          </a>
          <a
            href="https://eldar.beehiiv.com"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="Newsletter"
          >
            <Mail className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </aside>
  );
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

function ratingToneByLabel(rating: RatingLabel): "bullish" | "neutral" | "bearish" {
  if (rating === "STRONG_BUY" || rating === "BUY") return "bullish";
  if (rating === "STRONG_SELL" || rating === "SELL") return "bearish";
  return "neutral";
}

function ratingLabelFromKey(rating: RatingLabel): string {
  return RATING_BANDS[rating].label;
}

function ratingLabelToneClass(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("strongly bullish") || normalized.includes("strong buy")) return "text-[#FFBF00]";
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

function toConfidenceLevel(dataCompleteness: number): "HIGH" | "MEDIUM" | "LOW" {
  if (dataCompleteness >= 0.9) return "HIGH";
  if (dataCompleteness >= 0.7) return "MEDIUM";
  return "LOW";
}

function scoreFactorBucket(
  factors: PersistedAnalysis["factors"],
  matcher: (factor: PersistedAnalysis["factors"][number]) => boolean
): number {
  const selected = factors.filter((factor) => factor.hasData && matcher(factor));
  if (selected.length === 0) return 0;
  const totalWeight = selected.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight <= 0) return 0;
  const totalPoints = selected.reduce((sum, factor) => sum + factor.points, 0);
  return Math.max(0, Math.min(10, (totalPoints / totalWeight) * 10));
}

function buildComparisonFactorTuple(analysis: PersistedAnalysis): [number, number, number, number] {
  const fundamentals = scoreFactorBucket(
    analysis.factors,
    (factor) => factor.category === "Fundamental" || factor.category === "Valuation"
  );
  const momentum = scoreFactorBucket(analysis.factors, (factor) => factor.category === "Technical");
  const valuation = scoreFactorBucket(analysis.factors, (factor) => factor.category === "Valuation");
  const sentiment = scoreFactorBucket(
    analysis.factors,
    (factor) => factor.category === "Sentiment" || factor.category === "Macro"
  );
  return [fundamentals, momentum, valuation, sentiment];
}

interface HackingScoreProps {
  value: number;
  triggerKey: string;
  className?: string;
  durationMs?: number;
}

function HackingScore({ value, triggerKey, className, durationMs = 200 }: HackingScoreProps): JSX.Element {
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

interface HackingValueTextProps {
  finalText: string;
  loading: boolean;
  triggerKey: string;
  className?: string;
  settleDurationMs?: number;
}

function hackerizeText(text: string): string {
  if (!text || text === "N/A") {
    return `${Math.random() > 0.5 ? "+" : "−"}${(Math.random() * 99).toFixed(1)}%`;
  }

  return text
    .replace(/[0-9]/g, () => String(Math.floor(Math.random() * 10)))
    .replace(/[+\-−]/g, () => (Math.random() > 0.5 ? "+" : "−"));
}

function HackingValueText({
  finalText,
  loading,
  triggerKey,
  className,
  settleDurationMs = 300
}: HackingValueTextProps): JSX.Element {
  const [displayText, setDisplayText] = useState<string>(finalText);
  const [isHacking, setIsHacking] = useState<boolean>(true);

  useEffect(() => {
    let timeoutId: number | null = null;

    setIsHacking(true);
    if (!loading) {
      timeoutId = window.setTimeout(() => {
        setIsHacking(false);
      }, settleDurationMs);
    }

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [loading, triggerKey, settleDurationMs]);

  useEffect(() => {
    if (!isHacking) {
      setDisplayText(finalText);
      return;
    }

    const tick = (): void => {
      setDisplayText(hackerizeText(finalText));
    };

    tick();
    const intervalId = window.setInterval(tick, 65);
    return () => window.clearInterval(intervalId);
  }, [isHacking, finalText]);

  return <span className={className}>{displayText}</span>;
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

function formatChartDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
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

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const angle = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  };
}

function describeDonutSlicePath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z"
  ].join(" ");
}

function scoreBandColor(score: number | null): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "#6B7280";
  if (score >= 7.9) return "#FFBF00";
  if (score >= 6.3) return "#10B981";
  if (score >= 4.1) return "#6B7280";
  if (score >= 2.8) return "#EF4444";
  return "#B91C1C";
}

function mergeIndexRows(primary: IndexYtdItem[], fallback: IndexYtdItem[]): IndexYtdItem[] {
  const fallbackByCode = new Map(fallback.map((item) => [item.code, item]));
  const primaryByCode = new Map(primary.map((item) => [item.code, item]));

  return ["US30", "US100", "US500"].map((code) => {
    const typedCode = code as IndexYtdItem["code"];
    const next = primaryByCode.get(typedCode);
    const previous = fallbackByCode.get(typedCode);
    if (!next && previous) return previous;
    if (!next) {
      return FALLBACK_INDICES_YTD.find((row) => row.code === typedCode) as IndexYtdItem;
    }

    return {
      ...next,
      current: next.current ?? previous?.current ?? null,
      ytdChangePercent: next.ytdChangePercent ?? previous?.ytdChangePercent ?? null,
      asOf: next.asOf ?? previous?.asOf ?? null,
      points: next.points.length > 0 ? next.points : previous?.points ?? []
    };
  });
}

function extractFirstNumeric(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function findFactorMatch(
  factors: PersistedAnalysis["factors"],
  factorNames: string[]
): PersistedAnalysis["factors"][number] | null {
  for (const factorName of factorNames) {
    const match = factors.find((factor) => factor.factor === factorName);
    if (match) {
      return match;
    }
  }
  return null;
}

function findFactorMetric(
  factors: PersistedAnalysis["factors"],
  factorName: string,
  fallbackFactorNames: string[] = []
): number | null {
  const match = findFactorMatch(factors, [factorName, ...fallbackFactorNames]);
  return extractFirstNumeric(match?.metricValue ?? null);
}

function findFactorSignal(
  factors: PersistedAnalysis["factors"],
  factorName: string,
  fallbackFactorNames: string[] = []
): FactorResult["signal"] | null {
  const match = findFactorMatch(factors, [factorName, ...fallbackFactorNames]);
  return match?.signal ?? null;
}

function factorSignalToneClass(signal: FactorResult["signal"] | null): string {
  if (signal === "BULLISH") return "text-emerald-300";
  if (signal === "BEARISH") return "text-red-300";
  return "text-white/75";
}

function formatSignedPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

function ratioToPercentPoints(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value * 100;
}

function factorActionHint(factorName: string): string {
  if (factorName.includes("EPS Estimate Revision")) return "EPS revision needs to turn positive";
  if (factorName.includes("Price vs 200SMA")) return "Momentum needs to recover above 200SMA";
  if (factorName.includes("52w Relative Strength")) return "Relative strength vs sector needs to improve";
  if (factorName.includes("EV/EBITDA")) return "Valuation needs to normalize versus sector peers";
  if (factorName.includes("Debt/Equity")) return "Leverage profile needs to improve";
  if (factorName.includes("Short Interest")) return "Short-interest pressure needs to cool";
  return `${factorName} needs to improve`;
}

function sectorRelativeState(vsSectorPercent: number | null): {
  arrow: string;
  value: string;
  label: "LEADING" | "LAGGING" | "IN LINE";
  toneClass: string;
} {
  if (typeof vsSectorPercent !== "number" || !Number.isFinite(vsSectorPercent)) {
    return {
      arrow: "•",
      value: "N/A",
      label: "IN LINE",
      toneClass: "text-white/55"
    };
  }

  if (vsSectorPercent >= 1) {
    return {
      arrow: "▲",
      value: formatSignedPercent(vsSectorPercent, 1),
      label: "LEADING",
      toneClass: "text-emerald-300"
    };
  }

  if (vsSectorPercent <= -1) {
    return {
      arrow: "▼",
      value: formatSignedPercent(vsSectorPercent, 1),
      label: "LAGGING",
      toneClass: "text-red-300"
    };
  }

  return {
    arrow: "•",
    value: formatSignedPercent(vsSectorPercent, 1),
    label: "IN LINE",
    toneClass: "text-white/55"
  };
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
  currentUserId,
  initialSymbol = null
}: StockDashboardProps): JSX.Element {
  const router = useRouter();
  const [isAppOpen, setIsAppOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("home");
  const [ticker, setTicker] = useState(initialSymbol && isTop100Sp500Symbol(initialSymbol) ? initialSymbol.toUpperCase() : "");
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
  const headerVisible = view === "home" ? homeHeaderVisible : true;
  const showFadeTransition = view === "home";

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
    if (!symbol || !isTop100Sp500Symbol(symbol)) return;
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
        .filter((item) => item.code === "US30" || item.code === "US100" || item.code === "US500");

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
        .filter((item) => item.symbol && item.shares > 0 && isTop100Sp500Symbol(item.symbol));

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
            .filter((holding) => isTop100Sp500Symbol(holding.symbol));

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
        setIndicesYtd((prev) => mergeIndexRows(payload.indices, prev));
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

    socket.on(SOCKET_EVENTS.WATCHLIST_UPDATED, handleWatchlistDelta);
    socket.on(SOCKET_EVENTS.MARKET_MOVERS_UPDATED, handleMarketMoversDelta);
    socket.on(SOCKET_EVENTS.INDICES_YTD_UPDATED, handleIndicesDelta);
    socket.on(SOCKET_EVENTS.EARNINGS_UPDATED, handleEarningsDelta);
    socket.on(SOCKET_EVENTS.MAG7_UPDATED, handleMag7Delta);

    return () => {
      cancelled = true;
      socket.off(SOCKET_EVENTS.WATCHLIST_UPDATED, handleWatchlistDelta);
      socket.off(SOCKET_EVENTS.MARKET_MOVERS_UPDATED, handleMarketMoversDelta);
      socket.off(SOCKET_EVENTS.INDICES_YTD_UPDATED, handleIndicesDelta);
      socket.off(SOCKET_EVENTS.EARNINGS_UPDATED, handleEarningsDelta);
      socket.off(SOCKET_EVENTS.MAG7_UPDATED, handleMag7Delta);
    };
  }, [socket, currentUserId]);

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
          setIndicesYtd((prev) => mergeIndexRows(nextIndices, prev));
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
          cache: "no-store",
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
      if (showSkeleton) {
        setHomeDashboardLoading(true);
      }
      setHomeDashboardError("");

      try {
        const params = new URLSearchParams({ sectorWindow: sectorRotationWindow });
        const response = await fetch(`/api/home/dashboard?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as HomeDashboardPayload & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load dashboard modules.");
        }
        if (disposed) return;
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
        if (!disposed) {
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
          label: "P/E",
          value: null as number | null,
          signal: null as FactorResult["signal"] | null,
          format: "multiple" as "multiple" | "percent"
        },
        revenueGrowth: { value: null as number | null, signal: null as FactorResult["signal"] | null },
        epsGrowth: { value: null as number | null, signal: null as FactorResult["signal"] | null },
        fcfYield: { value: null as number | null, signal: null as FactorResult["signal"] | null }
      };
    }

    const fundamentals = currentRating.fundamentals;
    const isReitValuation =
      currentRating.sector === "Real Estate" &&
      ((typeof fundamentals?.ffoYield === "number" && Number.isFinite(fundamentals.ffoYield)) ||
        findFactorMetric(currentRating.factors, "FFO Yield (REIT)") !== null);

    return {
      primaryValuation: {
        label: isReitValuation ? "FFO Yield" : "P/E",
        value: isReitValuation
          ? ratioToPercentPoints(fundamentals?.ffoYield ?? null) ?? findFactorMetric(currentRating.factors, "FFO Yield (REIT)")
          : fundamentals?.forwardPE ?? fundamentals?.trailingPE ?? findFactorMetric(currentRating.factors, "P/E vs Sector"),
        signal: isReitValuation
          ? findFactorSignal(currentRating.factors, "FFO Yield (REIT)")
          : findFactorSignal(currentRating.factors, "P/E vs Sector"),
        format: isReitValuation ? ("percent" as const) : ("multiple" as const)
      },
      revenueGrowth: {
        value: ratioToPercentPoints(fundamentals?.revenueGrowth ?? null) ?? findFactorMetric(currentRating.factors, "Revenue Growth"),
        signal: findFactorSignal(currentRating.factors, "Revenue Growth")
      },
      epsGrowth: {
        value:
          ratioToPercentPoints(fundamentals?.earningsQuarterlyGrowth ?? null) ?? findFactorMetric(currentRating.factors, "EPS Growth"),
        signal: findFactorSignal(currentRating.factors, "EPS Growth")
      },
      fcfYield: {
        value: ratioToPercentPoints(fundamentals?.fcfYield ?? null) ?? findFactorMetric(currentRating.factors, "FCF Yield"),
        signal: findFactorSignal(currentRating.factors, "FCF Yield")
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

    const normalizedIndices = mergeIndexRows(indicesYtd, FALLBACK_INDICES_YTD);
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

          <div className="max-h-[420px] overflow-y-auto overscroll-contain p-2">
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

          <div className="max-h-[70vh] overflow-auto rounded-2xl border border-white/15 bg-black/60 p-4">
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
        <aside className="card-grain rough-border absolute right-0 top-0 h-full w-full max-w-[480px] border-l border-white/15 bg-[#0a0a0a] p-5 shadow-2xl shadow-black/70">
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
    <div className="fixed right-6 top-4 z-[65] flex items-center gap-2">
      <button
        type="button"
        onClick={() => setView("watchlist")}
        className="eldar-nav-icon inline-flex h-10 w-10 items-center justify-center text-white/85"
        aria-label="Watchlist"
      >
        <Bookmark className="h-4 w-4" />
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
        <NavigationBar
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
        <div className="container mx-auto px-6 pb-20 pl-[104px] pr-10 pt-6">
            <div ref={heroSectionRef} className="mx-auto max-w-[1240px]">
              <div className="reveal-block mb-6 flex flex-col items-start gap-3">
                <button
                  type="button"
                  onClick={() => openCommandPalette(ticker)}
                  disabled={loading}
                  className="eldar-search-shell primary-cta flex h-14 w-full max-w-[520px] items-center justify-between rounded-3xl px-5 text-left text-base font-semibold transition-all duration-300"
                >
                  <span className="flex items-center gap-3 text-white/88">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                    {loading ? `Analyzing ${ticker || "symbol"}...` : "search stock"}
                  </span>
                  <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/60">/</span>
                </button>

              {apiError ? (
                <div className="w-full max-w-[560px] rounded-2xl border border-zinc-400/35 bg-zinc-300/10 p-4 backdrop-blur-xl">
                  <p className="text-sm text-zinc-100">{apiError}</p>
                </div>
              ) : null}
            </div>

            <div className="reveal-block grid gap-5 xl:grid-cols-12" style={{ transitionDelay: "80ms" }}>
              <MacroEnvironmentCard regime={homeDashboard?.regime ?? null} loading={homeDashboardLoading && !homeDashboard} />

              {homeDashboardLoading && !homeDashboard ? (
                <section className="eldar-panel texture-none p-6 xl:col-span-4">
                  <div className="mb-5">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Market News</p>
                  </div>
                  <LinesSkeleton rows={4} />
                </section>
              ) : (
                <MarketNewsPanel items={marketNews} />
              )}

              <section className="eldar-panel texture-none xl:col-span-7 p-6">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-white/48">Market Snapshot</p>
                </div>
                {homeDashboardLoading && !homeDashboard ? (
                  <LinesSkeleton rows={3} />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-5">
                    {snapshotItems.map((item) => (
                      <SnapshotTile key={item.label} item={item} />
                    ))}
                  </div>
                )}
              </section>

              {homeDashboardLoading && !homeDashboard ? (
                <section className="eldar-panel texture-none xl:col-span-8 p-6">
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

              <section className="eldar-panel texture-none xl:col-span-4 p-6">
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
        <NavigationBar
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
        <div className="container mx-auto px-6 pb-28 pl-[104px] pr-10 pt-6">
          <div className="mx-auto max-w-6xl">
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

    return (
      <div
        className="min-h-screen text-white"
        style={{
          background: appBackground
        }}
      >
        <NavigationBar
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
        <div className="container mx-auto px-6 pb-28 pl-[104px] pr-10 pt-6">
          <div className="mx-auto max-w-6xl">
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

            <div className="reveal-block grid gap-6 xl:grid-cols-[2fr_1fr]">
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
                        <Bookmark className={clsx("h-4 w-4", isInWatchlist && "fill-current")} />
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

                <div className="eldar-panel reveal-block rounded-3xl p-6" style={{ transitionDelay: "60ms" }}>
                  <h2 className="mb-4 text-lg font-semibold text-white">PRICE CHART</h2>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {PRICE_RANGE_OPTIONS.map((windowSize) => (
                        <button
                          key={`price-window-${windowSize}`}
                          type="button"
                          onClick={() => setPriceRange(windowSize)}
                          className={clsx(
                            "min-h-[36px] rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition",
                            priceRange === windowSize
                              ? "border-amber-300/40 bg-amber-200/10 text-amber-100"
                              : "border-white/20 bg-white/[0.03] text-white/70"
                          )}
                        >
                          {windowSize}
                        </button>
                      ))}
                    </div>
                    <p
                      className={clsx(
                        "text-sm font-semibold",
                        (priceHistoryChangePercent ?? 0) > 0 && "text-emerald-300",
                        (priceHistoryChangePercent ?? 0) < 0 && "text-red-300",
                        priceHistoryChangePercent === null && "text-white/65"
                      )}
                    >
                      <HackingValueText
                        finalText={formatSignedPercent(priceHistoryChangePercent, 2)}
                        loading={priceHistoryLoading}
                        triggerKey={`${currentRating.symbol}:${priceRange}:${priceHistory.length}:${priceHistoryChangePercent ?? "na"}`}
                      />
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/15 bg-zinc-950/45 p-4">
                    {priceHistoryLoading ? (
                      <LinesSkeleton rows={4} />
                    ) : priceHistory.length >= 2 ? (
                      <div className="space-y-2">
                        <svg
                          viewBox="0 0 720 220"
                          className="h-44 w-full"
                          preserveAspectRatio="none"
                          aria-label="Price history chart"
                          role="img"
                          onMouseMove={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            if (rect.width <= 0 || priceHistory.length <= 1) return;
                            const ratio = (event.clientX - rect.left) / rect.width;
                            const index = Math.round(Math.max(0, Math.min(1, ratio)) * (priceHistory.length - 1));
                            setPriceChartHoverIndex(index);
                          }}
                        >
                          <path d={buildSparklinePath(priceHistory.map((row) => row.price), 720, 220)} fill="none" stroke="rgba(255,191,0,0.88)" strokeWidth="2.4" strokeLinecap="round" />
                          {priceChartOverlay ? (
                            <>
                              <line x1={priceChartOverlay.x} y1="0" x2={priceChartOverlay.x} y2="220" stroke="rgba(255,255,255,0.28)" strokeDasharray="4 3" />
                              <line x1="0" y1={priceChartOverlay.y} x2="720" y2={priceChartOverlay.y} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 4" />
                              <circle cx={priceChartOverlay.x} cy={priceChartOverlay.y} r="4.2" fill="#FFBF00" stroke="rgba(0,0,0,0.6)" strokeWidth="1.2" />
                            </>
                          ) : null}
                        </svg>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/72">
                          <p className="font-mono">X: {priceChartOverlay?.xLabel ?? "N/A"}</p>
                          <p className="font-mono">Y: {priceChartOverlay?.yLabel ?? "N/A"}</p>
                          <p className="font-mono text-white/52">
                            Axis: X=time • Y=price
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-white/60">{priceHistoryError || "Price history is not available yet."}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="eldar-panel reveal-block rounded-3xl p-6" style={{ transitionDelay: "70ms" }}>
                    <h2 className="mb-4 text-lg font-semibold text-white">KEY FUNDAMENTALS</h2>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{fundamentalsSnapshot.primaryValuation.label}</p>
                        <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.primaryValuation.signal))}>
                          <HackingValueText
                            finalText={
                              fundamentalsSnapshot.primaryValuation.value !== null
                                ? fundamentalsSnapshot.primaryValuation.format === "percent"
                                  ? formatSignedPercent(fundamentalsSnapshot.primaryValuation.value, 1)
                                  : `${fundamentalsSnapshot.primaryValuation.value.toFixed(1)}x`
                                : "N/A"
                            }
                            loading={fundamentalsNumbersLoading}
                            triggerKey={`pe:${fundamentalsHackTrigger}`}
                          />
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Revenue Growth</p>
                        <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.revenueGrowth.signal))}>
                          <HackingValueText
                            finalText={formatSignedPercent(fundamentalsSnapshot.revenueGrowth.value, 1)}
                            loading={fundamentalsNumbersLoading}
                            triggerKey={`rev:${fundamentalsHackTrigger}`}
                          />
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">EPS Growth</p>
                        <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.epsGrowth.signal))}>
                          <HackingValueText
                            finalText={formatSignedPercent(fundamentalsSnapshot.epsGrowth.value, 1)}
                            loading={fundamentalsNumbersLoading}
                            triggerKey={`eps:${fundamentalsHackTrigger}`}
                          />
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">FCF Yield</p>
                        <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.fcfYield.signal))}>
                          <HackingValueText
                            finalText={formatSignedPercent(fundamentalsSnapshot.fcfYield.value, 1)}
                            loading={fundamentalsNumbersLoading}
                            triggerKey={`fcf:${fundamentalsHackTrigger}`}
                          />
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="eldar-panel reveal-block rounded-3xl p-6" style={{ transitionDelay: "75ms" }}>
                    <h2 className="mb-4 text-lg font-semibold text-white">SCORE HISTORY</h2>
                    <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-4 py-4">
                      <svg
                        viewBox="0 0 320 60"
                        className="h-16 w-full"
                        preserveAspectRatio="none"
                        aria-label="Score history chart"
                        role="img"
                        onMouseMove={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          if (rect.width <= 0 || scoreHistorySeries.length <= 1) return;
                          const ratio = (event.clientX - rect.left) / rect.width;
                          const index = Math.round(Math.max(0, Math.min(1, ratio)) * (scoreHistorySeries.length - 1));
                          setScoreChartHoverIndex(index);
                        }}
                      >
                        <path d={buildSparklinePath(scoreHistoryPoints, 320, 60)} fill="none" stroke="rgba(245,245,245,0.88)" strokeWidth="2" strokeLinecap="round" />
                        {scoreChartOverlay ? (
                          <>
                            <line x1={scoreChartOverlay.x} y1="0" x2={scoreChartOverlay.x} y2="60" stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
                            <line x1="0" y1={scoreChartOverlay.y} x2="320" y2={scoreChartOverlay.y} stroke="rgba(255,255,255,0.16)" strokeDasharray="3 4" />
                            <circle cx={scoreChartOverlay.x} cy={scoreChartOverlay.y} r="3.6" fill="#F5F5F5" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
                          </>
                        ) : null}
                      </svg>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
                        <p className="font-mono">X: {scoreChartOverlay?.xLabel ?? "N/A"}</p>
                        <p className="font-mono">Y: {scoreChartOverlay?.yLabel ?? "N/A"}</p>
                        <p className="font-mono text-white/52">Axis: X=timestamp • Y=score</p>
                      </div>
                      <p className="mt-3 text-xs text-white/65">
                        {scoreHistoryPoints[scoreHistoryPoints.length - 1] >= scoreHistoryPoints[0] ? "Improving trend" : "Deteriorating trend"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <DriversList title="Top Drivers" items={driverBullets} maxCollapsed={3} />
                  <DriversList title="Risks" items={riskBullets} maxCollapsed={3} tone="risks" />
                </div>
              </div>

              <aside className="space-y-6">
                <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "120ms" }}>
                  <h3 className="eldar-caption mb-3 text-xs text-white/60">SECTOR CONTEXT</h3>
                  {stockContextLoading ? (
                    <LinesSkeleton rows={4} />
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
                          <span>{currentRating.symbol} vs sector</span>
                          <span className="mx-2 font-mono">{sectorRelative.arrow} {sectorRelative.value}</span>
                          <span className={clsx("font-semibold", sectorRelative.toneClass)}>{sectorRelative.label}</span>
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
                      <LinesSkeleton rows={4} />
                    ) : (stockContext?.news?.length ?? 0) === 0 ? (
                      <EmptyState
                        icon="📰"
                        message={`No related news for ${currentRating.symbol}`}
                        action={{ label: "Open source", onClick: () => window.open(`https://finance.yahoo.com/quote/${encodeURIComponent(currentRating.symbol)}/news`, "_blank", "noopener,noreferrer") }}
                      />
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
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="eldar-caption text-xs text-white/60">JOURNAL</h3>
                    <button
                      type="button"
                      onClick={() => openJournalPage({ symbol: currentRating.symbol, type: "thesis" })}
                      className="eldar-btn-ghost min-h-[36px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
                    >
                      New entry for {currentRating.symbol}
                    </button>
                  </div>

                  {!currentUserId ? (
                    <p className="text-xs text-white/70">Sign in to access private journal entries.</p>
                  ) : journalRelatedLoading ? (
                    <LinesSkeleton rows={3} />
                  ) : journalRelatedEntries.length === 0 ? (
                    <EmptyState
                      icon="📓"
                      message={`No journal entries for ${currentRating.symbol}`}
                      action={{ label: "Write first entry", onClick: () => openJournalPage({ symbol: currentRating.symbol, type: "thesis" }) }}
                    />
                  ) : (
                    <div className="space-y-2">
                      {visibleJournalEntries.map((entry) => (
                        <button
                          key={`journal-${entry.id}`}
                          type="button"
                          onClick={() => openJournalPage({ symbol: currentRating.symbol, entryId: entry.id })}
                          className="w-full rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2 text-left transition hover:border-white/30"
                        >
                          <p className="truncate text-xs font-semibold text-white">{entry.ticker}</p>
                          <p className="mt-1 text-[10px] text-white/60">
                            {entry.status} • {new Date(entry.createdAt).toLocaleDateString()} • {entry.thesis}
                          </p>
                        </button>
                      ))}
                      {hiddenJournalLinksCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => setShowAllJournalLinks((value) => !value)}
                          className="text-[9px] uppercase tracking-[0.12em] text-[#FFBF00]"
                        >
                          {showAllJournalLinks ? "Less" : "More"}
                        </button>
                      ) : null}
                    </div>
                  )}
                  {journalRelatedError ? <p className="mt-2 text-[10px] text-zinc-200/80">{journalRelatedError}</p> : null}
                </div>

                <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "300ms" }}>
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
                      <LinesSkeleton rows={3} />
                    ) : (stockContext?.similarStocks?.length ?? 0) === 0 ? (
                      <EmptyState
                        icon="📊"
                        message="No same-sector stocks available"
                        action={{ label: "Back to search", onClick: () => openCommandPalette(currentRating.symbol) }}
                      />
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

                <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "340ms" }}>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-white">WHAT WOULD CHANGE THE RATING</h3>
                  {upgradePath.targetLabel ? (
                    <p className="mb-3 text-sm text-white/75">
                      To reach {upgradePath.targetLabel}:
                    </p>
                  ) : (
                    <p className="mb-3 text-sm text-white/75">Current rating is already at the top band.</p>
                  )}
                  <div className="space-y-1.5 text-sm text-white/82">
                    {upgradePath.actions.map((action, index) => (
                      <p key={`upgrade-action-bottom-${index}`}>· {action}</p>
                    ))}
                  </div>
                </div>
              </aside>
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
        <NavigationBar
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
        <div className="container mx-auto px-6 pb-28 pl-[104px] pr-10 pt-6">
          <div className="mx-auto max-w-6xl">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">Portfolio Health Checker</h1>
                <p className="mt-2 text-sm text-white/70">Build and evaluate your holdings with a weighted ELDAR portfolio score.</p>
              </div>
              <button
                type="button"
                onClick={() => openShareModal("portfolio")}
                disabled={!activePortfolioRating}
                className="eldar-share-inline inline-flex min-h-[40px] items-center gap-2 px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60"
              >
                <Share2 className="h-4 w-4" />
                Share
              </button>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(250px,0.55fr)_minmax(0,1.45fr)]">
              <div className="space-y-3">
                <div className="eldar-panel reveal-block rounded-3xl p-4">
                  <p className="mb-2 text-sm text-white/75">Add Your Stocks:</p>
                  <form
                    className="card-grain grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_86px_auto]"
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
                        /
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
                      className="eldar-btn-silver primary-cta flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </form>
                  {portfolioError ? (
                    <p className="mt-2 text-xs text-zinc-200/85">{portfolioError}</p>
                  ) : null}
                </div>

                <div className="eldar-panel reveal-block rounded-3xl p-4">
                  {portfolioHoldings.length === 0 ? (
                    <EmptyState
                      icon="📊"
                      message="No holdings yet"
                      action={{ label: "Add holdings", onClick: () => openCommandPalette("", "portfolio-add") }}
                    />
                  ) : (
                    <div className="p-1">
                      <div className="flex items-center justify-center">
                        <svg viewBox="0 0 260 260" className="h-[210px] w-[210px]" role="img" aria-label="Portfolio holdings wheel">
                          <circle cx="130" cy="130" r="108" fill="#0c0c0c" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                          {portfolioWheelRows.map((row) => (
                            <path
                              key={`wheel-${row.id}`}
                              d={describeDonutSlicePath(130, 130, 52, 108, row.startAngle, row.endAngle)}
                              fill={scoreBandColor(row.score)}
                              fillOpacity={portfolioWheelHoverId === row.id || portfolioDrawerHoldingId === row.id ? 0.8 : 0.38}
                              stroke="rgba(255,255,255,0.16)"
                              strokeWidth={portfolioWheelHoverId === row.id || portfolioDrawerHoldingId === row.id ? 1.8 : 1}
                              className="cursor-pointer transition-all duration-150"
                              onMouseEnter={() => setPortfolioWheelHoverId(row.id)}
                              onMouseLeave={() => setPortfolioWheelHoverId((prev) => (prev === row.id ? null : prev))}
                              onClick={() => setPortfolioDrawerHoldingId(row.id)}
                            />
                          ))}
                          <circle cx="130" cy="130" r="52" fill="#0a0a0a" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
                          <text
                            x="130"
                            y="121"
                            textAnchor="middle"
                            fontSize="15"
                            fontWeight="700"
                            fontFamily="Neue Haas Grotesk Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                            fill="#f5f5f5"
                          >
                            {activePortfolioWheelRow?.symbol ?? "—"}
                          </text>
                          <text
                            x="130"
                            y="141"
                            textAnchor="middle"
                            fontSize="10"
                            fontFamily="Neue Haas Grotesk Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                            fill="#9ca3af"
                          >
                            {activePortfolioWheelRow?.allocationPct !== null && activePortfolioWheelRow?.allocationPct !== undefined
                              ? `${activePortfolioWheelRow.allocationPct.toFixed(1)}%`
                              : "allocation"}
                          </text>
                        </svg>
                      </div>
                      {activePortfolioRating ? (
                        <div className="mt-2 text-center">
                          <p className="text-xl font-bold text-white">
                            {"★".repeat(activePortfolioRating.stars)}
                            {"☆".repeat(5 - activePortfolioRating.stars)}
                          </p>
                          <p
                            className="mt-1 text-sm font-semibold"
                            style={{ color: RATING_BANDS[activePortfolioRating.rating].color }}
                          >
                            {RATING_BANDS[activePortfolioRating.rating].label}
                          </p>
                          <p className="mt-1 text-xs text-white/60">
                            Rated vs: {activePortfolioRating.peerGroup} peers
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-center text-sm font-semibold text-white/75">Portfolio Rating</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="eldar-panel reveal-block rounded-3xl p-4">
                {activePortfolioRating ? (
                  <PortfolioRatingPanel rating={activePortfolioRating} />
                ) : (
                  <RatingCardSkeleton />
                )}
              </div>
            </div>
          </div>
        </div>
        {portfolioDrawerRow ? (
          <div className="fixed inset-0 z-[95]">
            <button
              type="button"
              aria-label="Close drawer"
              className="absolute inset-0 bg-black/45"
              onClick={() => setPortfolioDrawerHoldingId(null)}
            />
            <aside className="card-grain rough-border absolute right-0 top-0 h-full w-full max-w-[480px] border-l border-white/15 bg-[#0a0a0a] p-5 shadow-2xl shadow-black/70">
              <div className="sticky top-0 z-10 mb-4 flex items-center justify-between border-b border-white/10 bg-[#0a0a0a] pb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Holding Details</p>
                  <p className="mt-1 font-mono text-xl font-bold text-white">{portfolioDrawerRow.symbol}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPortfolioDrawerHoldingId(null)}
                  className="eldar-btn-ghost min-h-[40px] rounded-xl px-3 text-xs font-semibold uppercase tracking-[0.12em]"
                >
                  Close
                </button>
              </div>
              <div className="space-y-3 overflow-y-auto pb-24">
                <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Allocation</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-white">
                    {portfolioDrawerRow.allocationPct !== null ? `${portfolioDrawerRow.allocationPct.toFixed(1)}%` : "Pending"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Shares</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-white">{portfolioDrawerRow.shares}</p>
                  </div>
                  <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Position Value</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-white">
                      {portfolioDrawerRow.positionValue !== null
                        ? formatPrice(portfolioDrawerRow.positionValue, portfolioDrawerRow.currency)
                        : "N/A"}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl border border-white/12 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">ELDAR Band</p>
                  <p className="mt-1 text-sm font-semibold" style={{ color: scoreBandColor(portfolioDrawerRow.score) }}>
                    {portfolioDrawerRow.ratingLabel ?? "Pending"}
                  </p>
                </div>
                {portfolioDrawerRow.error ? (
                  <div className="rounded-xl border border-red-300/30 bg-red-400/10 p-3 text-xs text-red-100">{portfolioDrawerRow.error}</div>
                ) : null}
              </div>
              <div className="sticky bottom-0 z-10 mt-4 flex items-center gap-2 border-t border-white/10 bg-[#0a0a0a] pt-3">
                <button
                  type="button"
                  onClick={() => {
                    void refreshPortfolioHolding(portfolioDrawerRow.symbol);
                  }}
                  className="eldar-btn-silver min-h-[44px] flex-1 rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.12em]"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => removePortfolioHolding(portfolioDrawerRow.id)}
                  className="eldar-btn-ghost min-h-[44px] flex-1 rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.12em]"
                >
                  Remove
                </button>
              </div>
            </aside>
          </div>
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
      <NavigationBar
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
      <div className="container mx-auto px-6 pb-28 pl-[104px] pr-10 pt-6">
        <div className="mx-auto max-w-4xl">
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
