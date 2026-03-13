import { analyzeStock } from "@/lib/analyze";
import { fetchAlphaVantageQuoteSnapshot } from "@/lib/market/providers/alpha-vantage";
import { fetchAlpacaQuoteSnapshot } from "@/lib/market/providers/alpaca";
import { fetchEodhdQuoteSnapshot } from "@/lib/market/providers/eodhd";
import { fetchFinnhubQuoteSnapshot } from "@/lib/market/providers/finnhub";
import { fetchFmpQuoteSnapshot } from "@/lib/market/providers/fmp";
import { fetchMassiveQuoteSnapshot } from "@/lib/market/providers/massive";
import { log } from "@/lib/logger";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { mergePriceObservations } from "@/lib/market/orchestration/price-merge";
import { fetchYahooQuoteSnapshot } from "@/lib/market/providers/yahoo";
import { getMag7Scores, saveMag7Scores } from "@/lib/storage/index";
import type { Mag7ScoreCard } from "@/lib/types";

export const MAG7_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] as const;
const LIVE_OPEN_CACHE_TTL_MS = 20_000;
const LIVE_CLOSED_CACHE_TTL_MS = 120_000;
const HOME_OPEN_CACHE_TTL_MS = 30_000;
const HOME_CLOSED_CACHE_TTL_MS = 180_000;

export interface Mag7SnapshotPayload {
  cards: Mag7ScoreCard[];
  marketOpen: boolean | null;
}

interface Mag7RuntimeCache {
  cards: Mag7ScoreCard[];
  marketOpen: boolean;
  expiresAt: number;
}

let liveCache: Mag7RuntimeCache | null = null;
let homepageCache: Mag7RuntimeCache | null = null;

function cloneCards(cards: Mag7ScoreCard[]): Mag7ScoreCard[] {
  return cards.map((card) => ({ ...card }));
}

function getDailyRefreshAnchor(now = new Date()): Date {
  const anchor = new Date(now);
  anchor.setHours(6, 0, 0, 0);

  if (now < anchor) {
    anchor.setDate(anchor.getDate() - 1);
  }

  return anchor;
}

function isRefreshDue(cache: Mag7ScoreCard[], now = new Date()): boolean {
  if (cache.length < MAG7_SYMBOLS.length) {
    return true;
  }

  const anchor = getDailyRefreshAnchor(now).getTime();
  const oldestUpdate = Math.min(...cache.map((item) => new Date(item.updatedAt).getTime()));
  return !Number.isFinite(oldestUpdate) || oldestUpdate < anchor;
}

function sortCards(cards: Mag7ScoreCard[]): Mag7ScoreCard[] {
  const rank = (value: number | null): number => (typeof value === "number" && Number.isFinite(value) ? value : -Infinity);
  return [...cards].sort(
    (a, b) => rank(b.changePercent) - rank(a.changePercent) || b.score - a.score || a.symbol.localeCompare(b.symbol)
  );
}

async function fetchLatestQuoteWithFallback(symbol: string): Promise<{ price: number | null; changePercent: number | null }> {
  const [eodhd, yahoo, alpaca, fmp, alpha, finnhub, massive] = await Promise.all([
    fetchEodhdQuoteSnapshot(symbol),
    fetchYahooQuoteSnapshot(symbol),
    fetchAlpacaQuoteSnapshot(symbol),
    fetchFmpQuoteSnapshot(symbol),
    fetchAlphaVantageQuoteSnapshot(symbol),
    fetchFinnhubQuoteSnapshot(symbol),
    fetchMassiveQuoteSnapshot(symbol)
  ]);

  const merged = mergePriceObservations({
    symbol,
    observations: [
      { source: "EODHD", price: eodhd.price, timestampMs: eodhd.asOfMs, baseWeight: 1.0 },
      { source: "YAHOO", price: yahoo.price, timestampMs: yahoo.asOfMs, baseWeight: 0.9 },
      { source: "ALPACA", price: alpaca.price, timestampMs: alpaca.asOfMs, baseWeight: 0.85 },
      { source: "FMP", price: fmp.price, timestampMs: fmp.asOfMs, baseWeight: 0.8 },
      { source: "ALPHA_VANTAGE", price: alpha.price, timestampMs: alpha.asOfMs, baseWeight: 0.7 },
      { source: "FINNHUB", price: finnhub.price, timestampMs: finnhub.asOfMs, baseWeight: 0.6 },
      { source: "MASSIVE", price: massive.price, timestampMs: massive.asOfMs, baseWeight: 0.5 }
    ]
  });

  for (const warning of merged.warnings) {
    log({
      level: "warn",
      service: "mag7",
      message: warning.message,
      warningType: warning.type,
      symbol
    });
  }

  return {
    price: merged.value,
    changePercent: finnhub.changePercent ?? alpaca.changePercent
  };
}

async function enrichCardsWithLatestQuotes(cards: Mag7ScoreCard[], updateChangePercent: boolean): Promise<Mag7ScoreCard[]> {
  const updatedAt = new Date().toISOString();
  const enriched = await Promise.all(
    cards.map(async (card) => {
      const quote = await fetchLatestQuoteWithFallback(card.symbol);
      return {
        ...card,
        currentPrice: quote.price ?? card.currentPrice,
        changePercent: updateChangePercent ? (quote.changePercent ?? card.changePercent) : card.changePercent,
        updatedAt
      };
    })
  );

  return sortCards(enriched);
}

export async function refreshMag7Scores(): Promise<Mag7ScoreCard[]> {
  const generatedAt = new Date().toISOString();

  const cards = await Promise.all(
    MAG7_SYMBOLS.map(async (symbol) => {
      const [analysis, quote] = await Promise.all([analyzeStock(symbol), fetchFinnhubQuoteSnapshot(symbol)]);
      return {
        symbol: analysis.symbol,
        companyName: analysis.companyName,
        score: analysis.score,
        rating: analysis.rating,
        currentPrice: quote.price ?? analysis.currentPrice,
        changePercent: quote.changePercent,
        updatedAt: generatedAt
      } satisfies Mag7ScoreCard;
    })
  );

  const sorted = sortCards(cards);
  await saveMag7Scores(sorted);
  liveCache = null;
  homepageCache = null;
  return sorted;
}

export async function getHomepageMag7Scores(): Promise<Mag7ScoreCard[]> {
  const marketOpen = isNySessionOpen();
  if (homepageCache && Date.now() < homepageCache.expiresAt && homepageCache.marketOpen === marketOpen) {
    return cloneCards(homepageCache.cards);
  }

  const cached = await getMag7Scores();
  const base = cached.length === 0 ? await refreshMag7Scores() : sortCards(cached);
  const cards = await enrichCardsWithLatestQuotes(base, true);
  homepageCache = {
    cards: cloneCards(cards),
    marketOpen,
    expiresAt: Date.now() + (marketOpen ? HOME_OPEN_CACHE_TTL_MS : HOME_CLOSED_CACHE_TTL_MS)
  };
  return cards;
}

/**
 * Builds a MAG7 aggregate payload for background snapshot refreshes.
 *
 * @param mode - Snapshot mode controlling whether live or homepage semantics are used.
 * @returns Snapshot payload consumed by the public MAG7 route.
 */
export async function buildMag7AggregatePayload(mode: "live" | "home"): Promise<Mag7SnapshotPayload> {
  if (mode === "live") {
    return getMag7LiveScores();
  }

  const cards = await getHomepageMag7Scores();
  return {
    cards,
    marketOpen: isNySessionOpen()
  };
}

export async function refreshMag7ScoresIfDue(): Promise<{ refreshed: boolean; cards: Mag7ScoreCard[] }> {
  const cached = await getMag7Scores();
  if (!isRefreshDue(cached)) {
    return { refreshed: false, cards: sortCards(cached) };
  }

  const cards = await refreshMag7Scores();
  return { refreshed: true, cards };
}

export async function getMag7LiveScores(): Promise<{ cards: Mag7ScoreCard[]; marketOpen: boolean }> {
  if (liveCache && Date.now() < liveCache.expiresAt) {
    return { cards: cloneCards(liveCache.cards), marketOpen: liveCache.marketOpen };
  }

  const cached = await getMag7Scores();
  const base = cached.length === 0 ? await refreshMag7Scores() : sortCards(cached);
  const marketOpen = isNySessionOpen();
  const cards = await enrichCardsWithLatestQuotes(base, true);
  liveCache = {
    cards: cloneCards(cards),
    marketOpen,
    expiresAt: Date.now() + (marketOpen ? LIVE_OPEN_CACHE_TTL_MS : LIVE_CLOSED_CACHE_TTL_MS)
  };
  return { cards, marketOpen };
}
