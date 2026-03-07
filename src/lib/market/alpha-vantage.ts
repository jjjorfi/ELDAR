import { fetchJsonOrNull, parseOptionalNumber, readEnvToken, setUrlSearchParams } from "@/lib/market/adapter-utils";
import { normalizeRatio } from "@/lib/utils";

interface HistoryPoint {
  date: Date;
  close: number | null;
}

export interface AlphaVantageQuoteSnapshot {
  price: number | null;
  asOfMs: number | null;
}

export interface AlphaVantageFallbackData {
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  marketCap: number | null;
  forwardPE: number | null;
  debtToEquity: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  operatingCashflow: number | null;
  bullishNewsCount: number;
  bearishNewsCount: number;
}

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const ALPHA_VANTAGE_FETCH_TIMEOUT_MS = 4_500;

/**
 * Reads the configured Alpha Vantage API key.
 *
 * @returns API key when set, otherwise null.
 */
function alphaVantageApiKey(): string | null {
  return readEnvToken("ALPHA_VANTAGE_API_KEY");
}

/**
 * Indicates whether Alpha Vantage integration is available.
 *
 * @returns True when API key exists.
 */
export function isAlphaVantageConfigured(): boolean {
  return alphaVantageApiKey() !== null;
}

/**
 * Parses numeric values from Alpha Vantage fields.
 *
 * @param raw Raw payload value.
 * @returns Finite numeric value or null.
 */
function parseNumeric(raw: unknown): number | null {
  return parseOptionalNumber(raw, { allowCommas: true, allowPercent: true });
}

/**
 * Parses and normalizes ratio values into decimal form.
 *
 * @param raw Raw payload value.
 * @returns Normalized ratio or null.
 */
function parseRatio(raw: unknown): number | null {
  const value = parseNumeric(raw);
  if (value === null) return null;
  return normalizeRatio(value);
}

/**
 * Calls Alpha Vantage endpoint with provided parameters.
 *
 * @param params Query string parameters.
 * @returns Payload object or null on error/rate-limit.
 */
async function fetchAlphaVantage(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const apiKey = alphaVantageApiKey();

  if (!apiKey) {
    return null;
  }

  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  setUrlSearchParams(url, {
    ...params,
    apikey: apiKey
  });

  return fetchJsonOrNull<Record<string, unknown>>(url, {
    timeoutMs: ALPHA_VANTAGE_FETCH_TIMEOUT_MS,
    revalidateSeconds: 300,
    isInvalidPayload: (payload) => {
      if (typeof payload !== "object" || payload === null) return true;
      const record = payload as Record<string, unknown>;
      return (
        typeof record.Note === "string" ||
        typeof record.Information === "string" ||
        typeof record["Error Message"] === "string"
      );
    }
  });
}

/**
 * Parses company/fundamental fields from the OVERVIEW endpoint.
 *
 * @param payload Alpha Vantage overview payload.
 * @returns Normalized fallback fundamentals excluding news fields.
 */
function parseOverview(
  payload: Record<string, unknown> | null
): Omit<AlphaVantageFallbackData, "bullishNewsCount" | "bearishNewsCount"> {
  if (!payload) {
    return {
      companyName: null,
      sector: null,
      industry: null,
      currency: null,
      marketCap: null,
      forwardPE: null,
      debtToEquity: null,
      profitMargin: null,
      revenueGrowth: null,
      operatingCashflow: null
    };
  }

  const companyName = typeof payload.Name === "string" ? payload.Name : null;
  const sector = typeof payload.Sector === "string" ? payload.Sector : null;
  const industry = typeof payload.Industry === "string" ? payload.Industry : null;
  const currency = typeof payload.Currency === "string" ? payload.Currency : null;

  const marketCap = parseNumeric(payload.MarketCapitalization);
  const forwardPE = parseNumeric(payload.ForwardPE) ?? parseNumeric(payload.PERatio);
  const debtToEquity = parseRatio(payload.DebtToEquityRatio);
  const profitMargin = parseRatio(payload.ProfitMargin);
  const revenueGrowth = parseRatio(payload.QuarterlyRevenueGrowthYOY);
  const operatingCashflow = parseNumeric(payload.OperatingCashflow);

  return {
    companyName,
    sector,
    industry,
    currency,
    marketCap,
    forwardPE,
    debtToEquity,
    profitMargin,
    revenueGrowth,
    operatingCashflow
  };
}

/**
 * Classifies sentiment from optional score/label pair.
 *
 * @param score Numeric sentiment score.
 * @param label Text sentiment label.
 * @returns Normalized sentiment bucket.
 */
function scoreSentiment(score: number | null, label: string | null): "POSITIVE" | "NEGATIVE" | "NEUTRAL" {
  if (score !== null) {
    if (score > 0.15) return "POSITIVE";
    if (score < -0.15) return "NEGATIVE";
  }

  if (label) {
    const normalized = label.toLowerCase();
    if (normalized.includes("bullish")) return "POSITIVE";
    if (normalized.includes("bearish")) return "NEGATIVE";
  }

  return "NEUTRAL";
}

/**
 * Parses and aggregates bullish/bearish counts from NEWS_SENTIMENT feed.
 *
 * @param payload News sentiment payload.
 * @param symbol Target ticker.
 * @returns Bullish and bearish article counts.
 */
function parseNews(payload: Record<string, unknown> | null, symbol: string): { bullishNewsCount: number; bearishNewsCount: number } {
  if (!payload) {
    return {
      bullishNewsCount: 0,
      bearishNewsCount: 0
    };
  }

  const feed = Array.isArray(payload.feed) ? payload.feed : [];
  let bullishNewsCount = 0;
  let bearishNewsCount = 0;

  for (const entry of feed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const overallScore = parseNumeric(record.overall_sentiment_score);
    const overallLabel = typeof record.overall_sentiment_label === "string" ? record.overall_sentiment_label : null;

    const tickerSentiment = Array.isArray(record.ticker_sentiment) ? record.ticker_sentiment : [];

    let counted = false;

    for (const tickerEntry of tickerSentiment) {
      if (typeof tickerEntry !== "object" || tickerEntry === null) {
        continue;
      }

      const tickerRecord = tickerEntry as Record<string, unknown>;
      const ticker = typeof tickerRecord.ticker === "string" ? tickerRecord.ticker.toUpperCase() : "";

      if (ticker !== symbol.toUpperCase()) {
        continue;
      }

      const tickerScore = parseNumeric(tickerRecord.ticker_sentiment_score);
      const tickerLabel = typeof tickerRecord.ticker_sentiment_label === "string" ? tickerRecord.ticker_sentiment_label : null;

      const outcome = scoreSentiment(tickerScore, tickerLabel);

      if (outcome === "POSITIVE") bullishNewsCount += 1;
      if (outcome === "NEGATIVE") bearishNewsCount += 1;

      counted = true;
      break;
    }

    if (counted) {
      continue;
    }

    const overallOutcome = scoreSentiment(overallScore, overallLabel);

    if (overallOutcome === "POSITIVE") bullishNewsCount += 1;
    if (overallOutcome === "NEGATIVE") bearishNewsCount += 1;
  }

  return {
    bullishNewsCount,
    bearishNewsCount
  };
}

/**
 * Fetches Alpha Vantage fallback fundamentals and sentiment.
 *
 * @param symbol Input ticker symbol.
 * @returns Normalized fallback payload.
 */
export async function fetchAlphaVantageFallbackData(symbol: string): Promise<AlphaVantageFallbackData> {
  if (!isAlphaVantageConfigured()) {
    return {
      companyName: null,
      sector: null,
      industry: null,
      currency: null,
      marketCap: null,
      forwardPE: null,
      debtToEquity: null,
      profitMargin: null,
      revenueGrowth: null,
      operatingCashflow: null,
      bullishNewsCount: 0,
      bearishNewsCount: 0
    };
  }

  const [overviewPayload, newsPayload] = await Promise.all([
    fetchAlphaVantage({ function: "OVERVIEW", symbol }),
    fetchAlphaVantage({ function: "NEWS_SENTIMENT", tickers: symbol, limit: "50", sort: "LATEST" })
  ]);

  const overview = parseOverview(overviewPayload);
  const news = parseNews(newsPayload, symbol);

  return {
    ...overview,
    ...news
  };
}

/**
 * Fetches full adjusted daily time series and converts to sorted history points.
 *
 * @param symbol Input ticker symbol.
 * @returns Chronological daily close history.
 */
export async function fetchAlphaVantageDailyHistory(symbol: string): Promise<HistoryPoint[]> {
  if (!isAlphaVantageConfigured()) {
    return [];
  }

  const payload = await fetchAlphaVantage({
    function: "TIME_SERIES_DAILY_ADJUSTED",
    symbol,
    outputsize: "full"
  });

  if (!payload) {
    return [];
  }

  const rawSeries = payload["Time Series (Daily)"];

  if (typeof rawSeries !== "object" || rawSeries === null) {
    return [];
  }

  const seriesEntries = Object.entries(rawSeries as Record<string, unknown>);

  const points = seriesEntries
    .map(([dateText, row]) => {
      if (typeof row !== "object" || row === null) return null;

      const close = parseNumeric((row as Record<string, unknown>)["4. close"]);
      const parsedDate = new Date(dateText);

      if (Number.isNaN(+parsedDate)) return null;

      return {
        date: parsedDate,
        close
      };
    })
    .filter((item): item is HistoryPoint => item !== null)
    .sort((a, b) => +a.date - +b.date);

  return points;
}

/**
 * Fetches only quote price from Alpha Vantage global quote endpoint.
 *
 * @param symbol Input ticker symbol.
 * @returns Positive price or null.
 */
export async function fetchAlphaVantageQuotePrice(symbol: string): Promise<number | null> {
  const snapshot = await fetchAlphaVantageQuoteSnapshot(symbol);
  return snapshot.price;
}

/**
 * Converts Alpha "latest trading day" field to epoch milliseconds.
 *
 * @param latestTradingDay Date string in YYYY-MM-DD format.
 * @returns Approximate quote timestamp at U.S. close or null.
 */
function parseQuoteTimestampMs(latestTradingDay: unknown): number | null {
  if (typeof latestTradingDay !== "string") {
    return null;
  }

  const trimmed = latestTradingDay.trim();
  if (!trimmed) {
    return null;
  }

  // Alpha quote only ships date; assume U.S. market close window for recency ordering.
  const parsed = Date.parse(`${trimmed}T21:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fetches Alpha Vantage global quote snapshot with timestamp.
 *
 * @param symbol Input ticker symbol.
 * @returns Quote snapshot.
 */
export async function fetchAlphaVantageQuoteSnapshot(symbol: string): Promise<AlphaVantageQuoteSnapshot> {
  if (!isAlphaVantageConfigured()) {
    return { price: null, asOfMs: null };
  }

  const payload = await fetchAlphaVantage({
    function: "GLOBAL_QUOTE",
    symbol
  });

  if (!payload) {
    return { price: null, asOfMs: null };
  }

  const quote = payload["Global Quote"];
  if (typeof quote !== "object" || quote === null) {
    return { price: null, asOfMs: null };
  }

  const price = parseNumeric((quote as Record<string, unknown>)["05. price"]);
  const normalizedPrice = price !== null && price > 0 ? price : null;
  const asOfMs = parseQuoteTimestampMs((quote as Record<string, unknown>)["07. latest trading day"]);

  return {
    price: normalizedPrice,
    asOfMs
  };
}
