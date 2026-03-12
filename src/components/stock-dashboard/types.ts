import type { Mag7ScoreCard, PersistedAnalysis, WatchlistItem } from "@/lib/types";

export type ViewMode = "home" | "results" | "watchlist" | "portfolio";
export type ThemeMode = "dark" | "light";
export type AuthMode = "login" | "signup";
export type AnalysisPhase = "idle" | "fetching" | "rendering";
export type PaletteAction = "analyze" | "portfolio-add" | "compare-add" | "watchlist-add";

export interface StockDashboardProps {
  initialHistory: PersistedAnalysis[];
  initialWatchlist: WatchlistItem[];
  initialMag7Scores: Mag7ScoreCard[];
  currentUserId: string | null;
  initialSymbol?: string | null;
}

export interface SearchResultItem {
  symbol: string;
  companyName: string;
  sector: string;
  domain: string | null;
  marketCap?: number | null;
}

export interface ContextSimilarStock {
  symbol: string;
  companyName: string;
}

export interface ContextNewsItem {
  headline: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
}

export interface JournalRelatedEntry {
  id: string;
  ticker: string;
  thesis: string;
  status: "PLANNING" | "OPEN" | "CLOSED";
  createdAt: string;
}

export interface StockContextData {
  symbol: string;
  sector: string;
  sectorAverageScore: number | null;
  vsSectorPercent: number | null;
  similarStocks: ContextSimilarStock[];
  news: ContextNewsItem[];
}

export interface MarketMoverItem {
  symbol: string;
  companyName: string;
  currentPrice: number | null;
  changePercent: number | null;
}

export interface IndexYtdItem {
  code: "US2000" | "US100" | "US500";
  label: string;
  symbol: string;
  current: number | null;
  ytdChangePercent: number | null;
  asOf: string | null;
  points: number[];
}

export interface UpcomingEarningsItem {
  symbol: string;
  companyName: string;
  date: string | null;
  epsEstimate: number | null;
}

export interface HomeTickerDrawerState {
  source: "earnings" | "movers";
  symbol: string;
  companyName: string;
  date: string | null;
  epsEstimate: number | null;
  currentPrice: number | null;
  changePercent: number | null;
}

export interface PriceHistoryPoint {
  time: string;
  price: number;
}

export interface LiveQuotePollRow {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

export interface PortfolioHolding {
  id: string;
  symbol: string;
  shares: number;
  analysis: PersistedAnalysis | null;
  loading: boolean;
  error: string | null;
  expanded: boolean;
}

export interface ComparisonState {
  analysis: PersistedAnalysis | null;
  loading: boolean;
  error: string | null;
}
