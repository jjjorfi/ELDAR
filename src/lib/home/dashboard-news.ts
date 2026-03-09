// AI CONTEXT TRACE
// Builds the dashboard's market-news module. This file keeps headline ranking
// and provider fallback logic out of the dashboard route/service so the home
// payload stays thin. Current default focus is US100 / mega-cap names, but the
// focus symbol builder is intentionally separate so we can extend to other
// universes later without rewriting the module.

import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { withTimeoutFallback } from "@/lib/async/timeout";
import { fetchAlphaVantageNewsHeadlines } from "@/lib/market/alpha-vantage";
import { fetchFinnhubCompanyNews } from "@/lib/market/finnhub";
import { fetchGoogleNewsHeadlines } from "@/lib/market/google-news";

import type { HomeNewsItem } from "@/lib/home/dashboard-types";

const NEWS_CACHE_TTL_MS = 90_000;
const NEWS_REDIS_TTL_SECONDS = 90;
const DEFAULT_US100_FOCUS = ["NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL", "AVGO", "TSLA", "AMD", "NFLX"];
const MAX_FOCUS_SYMBOLS = 8;
const FINANCE_SOURCE_HINTS = ["Reuters", "Bloomberg", "CNBC", "Yahoo Finance", "MarketWatch", "Barron's", "The Wall Street Journal", "Nasdaq"];
const MARKET_KEYWORDS = ["stock", "stocks", "nasdaq", "s&p", "earnings", "guidance", "shares", "market", "ai", "chip", "cloud", "revenue", "forecast", "tariff", "fed", "rates"];
const OFF_TOPIC_KEYWORDS = ["game", "games", "movie", "movies", "tv", "show", "shows", "streaming catalog", "trailer"];

let newsCache = new Map<string, { expiresAt: number; payload: HomeNewsItem[] }>();
let newsInFlight = new Map<string, Promise<HomeNewsItem[]>>();

function dashboardNewsKey(symbols: string[]): string {
  return `home:dashboard:news:${symbols.join(",")}`;
}

export function buildDashboardNewsFocusSymbols(carriedSymbols: string[], moverSymbols: string[]): string[] {
  return Array.from(
    new Set(
      [
        ...moverSymbols.slice(0, 4),
        ...carriedSymbols.slice(0, 6),
        ...DEFAULT_US100_FOCUS
      ]
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, MAX_FOCUS_SYMBOLS);
}

function normalizeHeadline(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function hoursAgo(iso: string | null): number {
  if (!iso) return 999;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 999;
  return Math.max(0, (Date.now() - time) / 3_600_000);
}

function scoreHeadline(item: HomeNewsItem, focusSymbols: string[]): number {
  const symbolBoost = item.symbol && focusSymbols.includes(item.symbol) ? 3 : 0;
  const freshnessPenalty = Math.min(hoursAgo(item.publishedAt), 72) / 24;
  const sourceBoost =
    item.source && FINANCE_SOURCE_HINTS.some((hint) => item.source?.toLowerCase().includes(hint.toLowerCase()))
      ? 1.2
      : item.source
        ? 0.5
        : 0;
  const sentimentBoost = item.sentiment === "NEUTRAL" ? 0 : 0.2;
  const headlineLower = item.headline.toLowerCase();
  const keywordBoost = MARKET_KEYWORDS.some((keyword) => headlineLower.includes(keyword)) ? 0.9 : 0;
  const offTopicPenalty = OFF_TOPIC_KEYWORDS.some((keyword) => headlineLower.includes(keyword)) ? 2.4 : 0;
  return symbolBoost + sourceBoost + sentimentBoost + keywordBoost - offTopicPenalty - freshnessPenalty;
}

async function fetchFinnhubDashboardNews(symbols: string[]): Promise<HomeNewsItem[]> {
  const newsSets = await Promise.all(
    symbols.slice(0, 4).map((symbol) =>
      withTimeoutFallback(fetchFinnhubCompanyNews(symbol, 10, 4), 1_400, [])
        .then((items) =>
          items.map<HomeNewsItem>((item) => ({
            symbol,
            headline: item.headline,
            url: item.url,
            source: item.source,
            publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
            sentiment: "NEUTRAL"
          }))
        )
    )
  );

  return newsSets.flat();
}

async function buildNewsPayload(focusSymbols: string[]): Promise<HomeNewsItem[]> {
  const [alphaNews, finnhubNews, googleNews] = await Promise.all([
    withTimeoutFallback(fetchAlphaVantageNewsHeadlines(focusSymbols, 10), 2_200, []),
    fetchFinnhubDashboardNews(focusSymbols),
    withTimeoutFallback(fetchGoogleNewsHeadlines(focusSymbols, 10), 2_200, [])
  ]);

  const merged: HomeNewsItem[] = [];
  const seen = new Set<string>();

  for (const item of [
    ...alphaNews,
    ...finnhubNews,
    ...googleNews.map<HomeNewsItem>((news) => ({
      symbol: news.symbol,
      headline: news.headline,
      url: news.url,
      source: news.source,
      publishedAt: news.publishedAt,
      sentiment: "NEUTRAL"
    }))
  ]) {
    const key = item.url ?? normalizeHeadline(item.headline);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({
      symbol: item.symbol,
      headline: item.headline,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
      sentiment: item.sentiment
    });
  }

  return merged
    .sort((left, right) => scoreHeadline(right, focusSymbols) - scoreHeadline(left, focusSymbols))
    .slice(0, 4);
}

export async function getDashboardMarketNews(focusSymbols: string[]): Promise<HomeNewsItem[]> {
  const normalized = Array.from(new Set(focusSymbols.map((value) => value.trim().toUpperCase()).filter(Boolean))).slice(0, MAX_FOCUS_SYMBOLS);
  if (normalized.length === 0) {
    return [];
  }

  const key = dashboardNewsKey(normalized);
  const memoryCached = newsCache.get(key);
  if (memoryCached && Date.now() < memoryCached.expiresAt) {
    return memoryCached.payload;
  }

  const redisCached = await cacheGetJson<HomeNewsItem[]>(key);
  if (redisCached) {
    newsCache.set(key, {
      expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
      payload: redisCached
    });
    return redisCached;
  }

  let inFlight = newsInFlight.get(key);
  if (!inFlight) {
    inFlight = buildNewsPayload(normalized)
      .then(async (payload) => {
        newsCache.set(key, {
          expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
          payload
        });
        await cacheSetJson(key, payload, NEWS_REDIS_TTL_SECONDS);
        return payload;
      })
      .finally(() => {
        newsInFlight.delete(key);
      });
    newsInFlight.set(key, inFlight);
  }

  return inFlight;
}
