import {
  parseOptionalNumber,
  parseOptionalString,
  parseTimestampMs,
  readEnvToken
} from "@/lib/market/adapter-utils";
import { normalizeRatio } from "@/lib/utils";

export interface FmpFallbackData {
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  marketCap: number | null;
  currentPrice: number | null;
  forwardPE: number | null;
  debtToEquity: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  articleCount: number;
}

export interface FmpQuoteSnapshot {
  price: number | null;
  asOfMs: number | null;
}

export interface FmpEarningsItem {
  symbol: string;
  date: string | null;
  period: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
}

const FMP_STABLE_BASE_URL = "https://financialmodelingprep.com/stable";
const FMP_V3_BASE_URL = "https://financialmodelingprep.com/api/v3";

/**
 * Reads the configured FMP API key.
 *
 * @returns API key value when configured, otherwise null.
 */
function fmpApiKey(): string | null {
  return readEnvToken("FMP_API_KEY");
}

/**
 * Parses numeric FMP fields.
 *
 * @param value Unknown payload field.
 * @returns Finite number or null.
 */
function asNumber(value: unknown): number | null {
  return parseOptionalNumber(value);
}

/**
 * Parses optional non-empty string fields.
 *
 * @param value Unknown payload field.
 * @returns Trimmed string or null.
 */
function asString(value: unknown): string | null {
  return parseOptionalString(value);
}

/**
 * Calls an FMP endpoint and returns parsed JSON.
 *
 * @param baseUrl FMP API base URL.
 * @param path Endpoint path.
 * @param params Query params.
 * @returns Parsed payload or null when request fails.
 */
async function fetchFmp<T>(baseUrl: string, path: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = fmpApiKey();

  if (!apiKey) {
    return null;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  url.searchParams.set("apikey", apiKey);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString(), {
      next: { revalidate: 300 },
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface FmpSearchRow {
  symbol?: string;
  name?: string;
  currency?: string;
  exchangeShortName?: string;
}

/**
 * Resolves canonical ticker identity via FMP search endpoint.
 *
 * @param symbol Input ticker symbol.
 * @returns Best matching row or null when not found.
 */
async function fetchSearchSymbol(symbol: string): Promise<FmpSearchRow | null> {
  const payload = await fetchFmp<FmpSearchRow[]>(FMP_STABLE_BASE_URL, "/search-symbol", { query: symbol });

  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const exact = payload.find((item) => (item.symbol ?? "").toUpperCase() === symbol.toUpperCase());
  return exact ?? payload[0];
}

/**
 * Builds an empty fallback shape.
 *
 * @returns Null-initialized fallback structure.
 */
function emptyFallback(): FmpFallbackData {
  return {
    companyName: null,
    sector: null,
    industry: null,
    currency: null,
    marketCap: null,
    currentPrice: null,
    forwardPE: null,
    debtToEquity: null,
    profitMargin: null,
    revenueGrowth: null,
    articleCount: 0
  };
}

/**
 * Extracts first valid quote price from mixed payload shapes.
 *
 * @param payload Unknown quote payload.
 * @returns Positive price or null.
 */
function extractFirstPrice(payload: unknown): number | null {
  const pickPrice = (row: Record<string, unknown>): number | null =>
    asNumber(row.price) ?? asNumber(row.close) ?? asNumber(row.last) ?? asNumber(row.lastPrice);

  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (typeof row !== "object" || row === null) continue;
      const parsed = pickPrice(row as Record<string, unknown>);
      if (parsed !== null && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }

  if (typeof payload === "object" && payload !== null) {
    const parsed = pickPrice(payload as Record<string, unknown>);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

/**
 * Extracts first valid quote snapshot from array/object payloads.
 *
 * @param payload Unknown quote payload.
 * @returns Quote snapshot with price and timestamp.
 */
function extractFirstQuoteSnapshot(payload: unknown): FmpQuoteSnapshot {
  const empty: FmpQuoteSnapshot = { price: null, asOfMs: null };

  const pick = (row: Record<string, unknown>): FmpQuoteSnapshot => {
    const price = asNumber(row.price) ?? asNumber(row.close) ?? asNumber(row.last) ?? asNumber(row.lastPrice);
    if (price === null || price <= 0) {
      return empty;
    }

    return {
      price,
      asOfMs:
        parseTimestampMs(row.timestamp) ??
        parseTimestampMs(row.lastUpdated) ??
        parseTimestampMs(row.updatedAt) ??
        parseTimestampMs(row.time)
    };
  };

  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (typeof row !== "object" || row === null) continue;
      const snapshot = pick(row as Record<string, unknown>);
      if (snapshot.price !== null) {
        return snapshot;
      }
    }
    return empty;
  }

  if (typeof payload === "object" && payload !== null) {
    return pick(payload as Record<string, unknown>);
  }

  return empty;
}

/**
 * Fetches best available FMP quote snapshot from stable then v3 quote endpoint.
 *
 * @param symbol Input ticker symbol.
 * @returns Price snapshot.
 */
export async function fetchFmpQuoteSnapshot(symbol: string): Promise<FmpQuoteSnapshot> {
  if (!fmpApiKey()) {
    return { price: null, asOfMs: null };
  }

  const [stableQuotePayload, v3QuotePayload] = await Promise.all([
    fetchFmp<unknown>(FMP_STABLE_BASE_URL, "/quote", { symbol }),
    fetchFmp<unknown>(FMP_V3_BASE_URL, `/quote/${encodeURIComponent(symbol)}`)
  ]);

  const stable = extractFirstQuoteSnapshot(stableQuotePayload);
  if (stable.price !== null) {
    return stable;
  }

  return extractFirstQuoteSnapshot(v3QuotePayload);
}

/**
 * Fetches only current quote price from FMP.
 *
 * @param symbol Input ticker symbol.
 * @returns Positive price or null.
 */
export async function fetchFmpQuotePrice(symbol: string): Promise<number | null> {
  const snapshot = await fetchFmpQuoteSnapshot(symbol);
  return snapshot.price;
}

/**
 * Fetches fallback fundamentals used when primary providers are incomplete.
 *
 * @param symbol Input ticker symbol.
 * @returns FMP fallback payload.
 */
export async function fetchFmpFallbackData(symbol: string): Promise<FmpFallbackData> {
  if (!fmpApiKey()) {
    return emptyFallback();
  }

  const [searchSymbol, stableProfilePayload, stableQuotePayload, v3QuotePayload] = await Promise.all([
    fetchSearchSymbol(symbol),
    fetchFmp<Array<Record<string, unknown>>>(FMP_STABLE_BASE_URL, "/profile", { symbol }),
    fetchFmp<unknown>(FMP_STABLE_BASE_URL, "/quote", { symbol }),
    fetchFmp<unknown>(FMP_V3_BASE_URL, `/quote/${encodeURIComponent(symbol)}`)
  ]);

  // Premium FMP v3 endpoints are intentionally disabled for free-plan compatibility.
  const ratiosPayload = null;
  const growthPayload = null;
  const newsPayload = null;

  const profile: Record<string, unknown> = Array.isArray(stableProfilePayload) ? stableProfilePayload[0] ?? {} : {};
  const ratios: Record<string, unknown> = Array.isArray(ratiosPayload) ? ratiosPayload[0] ?? {} : {};
  const growth: Record<string, unknown> = Array.isArray(growthPayload) ? growthPayload[0] ?? {} : {};
  const news = Array.isArray(newsPayload) ? newsPayload : [];

  const companyName = asString(profile.companyName) ?? asString(profile.name) ?? asString(searchSymbol?.name);
  const sector = asString(profile.sector);
  const industry = asString(profile.industry) ?? asString(profile.industryName);
  const currency = asString(profile.currency) ?? asString(searchSymbol?.currency);

  const currentPrice = extractFirstPrice(stableQuotePayload) ?? extractFirstPrice(v3QuotePayload) ?? asNumber(profile.price);
  const marketCap = asNumber(profile.mktCap);

  const forwardPE = asNumber(profile.pe) ?? asNumber(ratios.peRatioTTM) ?? asNumber(ratios.priceToEarningsRatioTTM);
  const debtToEquity = normalizeRatio(
    asNumber(ratios.debtEquityRatioTTM) ?? asNumber(ratios.debtToEquity) ?? asNumber(profile.debtToEquity)
  );
  const profitMargin = normalizeRatio(asNumber(ratios.netProfitMarginTTM) ?? asNumber(profile.netProfitMargin));
  const revenueGrowth = normalizeRatio(asNumber(growth.revenueGrowth));

  return {
    companyName,
    sector,
    industry,
    currency,
    marketCap,
    currentPrice,
    forwardPE,
    debtToEquity,
    profitMargin,
    revenueGrowth,
    articleCount: news.length
  };
}

/**
 * Builds a quarter/year period label from mixed payload fields.
 *
 * @param row Raw earnings row.
 * @returns Normalized period string or null.
 */
function normalizeEarningsPeriod(row: Record<string, unknown>): string | null {
  const period = asString(row.period);
  if (period) return period;

  const quarterNumber = asNumber(row.quarter);
  const yearNumber = asNumber(row.year);
  const quarter = quarterNumber !== null ? `Q${Math.round(quarterNumber)}` : asString(row.quarter);
  const year = yearNumber !== null ? String(Math.round(yearNumber)) : asString(row.year);

  if (quarter && year) return `${quarter} ${year}`;
  if (quarter) return quarter;
  if (year) return year;

  return null;
}

/**
 * Parses mixed FMP earnings payload rows into a normalized shape.
 *
 * @param payload Raw endpoint payload.
 * @returns Parsed earnings rows.
 */
function parseFmpEarningsRows(payload: unknown): FmpEarningsItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const rows: FmpEarningsItem[] = [];

  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const symbol = asString(row.symbol);
    if (!symbol) {
      continue;
    }

    const epsActual = asNumber(row.epsActual) ?? asNumber(row.eps);
    const epsEstimate = asNumber(row.epsEstimated) ?? asNumber(row.epsEstimate);
    const directSurprise = asNumber(row.epsSurprisePercent) ?? asNumber(row.surprisePercent) ?? asNumber(row.surprise);
    const surprisePercent =
      directSurprise ??
      (epsActual !== null && epsEstimate !== null && epsEstimate !== 0
        ? ((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100
        : null);

    rows.push({
      symbol: symbol.toUpperCase(),
      date: asString(row.date) ?? asString(row.fiscalDateEnding),
      period: normalizeEarningsPeriod(row),
      epsActual,
      epsEstimate,
      surprisePercent,
      revenueActual: asNumber(row.revenueActual) ?? asNumber(row.revenue),
      revenueEstimate: asNumber(row.revenueEstimated) ?? asNumber(row.revenueEstimate)
    });
  }

  return rows;
}

/**
 * Fetches FMP earnings calendar rows for a date range.
 *
 * @param from Inclusive start date in YYYY-MM-DD format.
 * @param to Inclusive end date in YYYY-MM-DD format.
 * @returns Normalized earnings rows.
 */
export async function fetchFmpEarningsCalendar(from: string, to: string): Promise<FmpEarningsItem[]> {
  if (!fmpApiKey()) {
    return [];
  }

  const payload = await fetchFmp<unknown>(FMP_V3_BASE_URL, "/earnings-calendar", { from, to });
  return parseFmpEarningsRows(payload);
}

/**
 * Fetches historical earnings rows for a single symbol.
 *
 * @param symbol Input ticker symbol.
 * @param limit Maximum rows to return.
 * @returns Normalized earnings rows sorted by latest date first.
 */
export async function fetchFmpEarningsHistory(symbol: string, limit = 8): Promise<FmpEarningsItem[]> {
  if (!fmpApiKey()) {
    return [];
  }

  const payload = await fetchFmp<unknown>(FMP_V3_BASE_URL, "/earnings", { symbol });
  return parseFmpEarningsRows(payload)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, Math.max(1, limit));
}
