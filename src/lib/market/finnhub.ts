import {
  fetchJsonOrNull,
  parseApiKeyList,
  parseOptionalNumber,
  parseOptionalString,
  pickFirstNumber,
  readEnvToken,
  setUrlSearchParams
} from "@/lib/market/adapter-utils";

const FINNHUB_FETCH_TIMEOUT_MS = 4_500;
const FINNHUB_AUTH_DISABLE_TTL_MS = 10 * 60_000;
let finnhubAuthDisabledUntil = 0;
let finnhubAuthWarnedAt = 0;

interface FinnhubRecommendationRow {
  buy?: number;
  hold?: number;
  period?: string;
  sell?: number;
  strongBuy?: number;
  strongSell?: number;
}

interface FinnhubNewsSentiment {
  sentiment?: {
    bullishPercent?: number;
    bearishPercent?: number;
  };
  companyNewsScore?: number;
}

export interface FinnhubSentimentSignal {
  bullishCount: number;
  bearishCount: number;
}

export interface FinnhubOptionFlow {
  putCallRatio: number | null;
  totalCallVolume: number | null;
  totalPutVolume: number | null;
  source: string | null;
}

export interface FinnhubEarningsSnapshot {
  actual: number | null;
  estimate: number | null;
  period: string | null;
  reportDate: string | null;
  surprisePercent: number | null;
}

export interface FinnhubCompanyProfile {
  sector: string | null;
  industry: string | null;
  shareOutstanding: number | null;
}

export interface FinnhubQuoteSnapshot {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

export interface FinnhubCompanyNewsItem {
  headline: string;
  url: string | null;
  source: string | null;
  datetime: number | null;
}

export interface FinnhubEarningsCalendarItem {
  symbol: string;
  date: string | null;
  period: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
  revenueEstimate: number | null;
}

export interface FinnhubInsiderSignal {
  netChangeShares90d: number | null;
  buyShares90d: number;
  sellShares90d: number;
  transactionCount90d: number;
}

/**
 * Reads and parses Finnhub API keys from env, including concatenated-key paste mistakes.
 *
 * @returns Unique validated API key candidates.
 */
export function getFinnhubApiKeys(): string[] {
  const raw = readEnvToken("FINNHUB_API_KEY") ?? "";
  return parseApiKeyList(raw, {
    minLength: 20,
    tokenPattern: /^[A-Za-z0-9]+$/,
    concatenated: {
      minRawLength: 20,
      chunkLengths: [20],
      rawPattern: /^[A-Za-z0-9]+$/
    }
  });
}

/**
 * Indicates whether at least one Finnhub API key is configured.
 *
 * @returns True when a key candidate is available.
 */
export function isFinnhubConfigured(): boolean {
  return getFinnhubApiKeys().length > 0;
}

/**
 * Performs a Finnhub API request using key rotation on failure.
 *
 * @param endpoint Endpoint path under /api/v1.
 * @param query Query parameters.
 * @returns Parsed payload or null when all keys fail.
 */
async function fetchFinnhub<T>(endpoint: string, query: Record<string, string>): Promise<T | null> {
  const tokens = getFinnhubApiKeys();
  const failureReasons: Array<{ kind: "http" | "invalid-payload" | "network"; message: string; status?: number }> = [];

  if (tokens.length === 0) {
    return null;
  }

  if (Date.now() < finnhubAuthDisabledUntil) {
    return null;
  }

  for (const token of tokens) {
    const url = new URL(`https://finnhub.io/api/v1/${endpoint}`);
    setUrlSearchParams(url, {
      ...query,
      token
    });

    const payload = await fetchJsonOrNull<T | { error?: string }>(url, {
      timeoutMs: FINNHUB_FETCH_TIMEOUT_MS,
      revalidateSeconds: 300,
      isInvalidPayload: (value) => {
        if (typeof value !== "object" || value === null) return false;
        return typeof (value as Record<string, unknown>).error === "string";
      },
      onError: (error) => {
        failureReasons.push(error);
      }
    });

    if (!payload) {
      continue;
    }

    return payload as T;
  }

  if (failureReasons.some((failure) => failure.status === 401 || failure.status === 403)) {
    finnhubAuthDisabledUntil = Date.now() + FINNHUB_AUTH_DISABLE_TTL_MS;
    if (Date.now() - finnhubAuthWarnedAt > FINNHUB_AUTH_DISABLE_TTL_MS) {
      finnhubAuthWarnedAt = Date.now();
      console.warn("[Finnhub Adapter]: auth unavailable (401/403). Suppressing Finnhub requests for 10m.");
    }
  }

  if (failureReasons.length > 0) {
    console.warn(
      `[Finnhub Adapter]: ${endpoint} exhausted ${tokens.length} key(s). Last failure: ${failureReasons[failureReasons.length - 1].kind}:${failureReasons[failureReasons.length - 1].message}`
    );
  }

  return null;
}

/**
 * Parses a numeric value from unknown payload data.
 *
 * @param value Unknown payload value.
 * @returns Finite number or null.
 */
function toNumber(value: unknown): number | null {
  return parseOptionalNumber(value);
}

/**
 * Parses a non-empty string from unknown payload data.
 *
 * @param value Unknown payload value.
 * @returns Trimmed string or null.
 */
function toStringValue(value: unknown): string | null {
  return parseOptionalString(value);
}

/**
 * Finds the first numeric field from an ordered key list.
 *
 * @param record Source record.
 * @param keys Candidate keys in priority order.
 * @returns First numeric field or null.
 */
function firstNumeric(record: Record<string, unknown>, keys: string[]): number | null {
  return pickFirstNumber(record, keys);
}

/**
 * Parses latest earnings row from Finnhub earnings history payload.
 *
 * @param payload Earnings endpoint payload.
 * @returns Latest available earnings snapshot.
 */
function parseLatestEarnings(payload: unknown): FinnhubEarningsSnapshot {
  const empty: FinnhubEarningsSnapshot = {
    actual: null,
    estimate: null,
    period: null,
    reportDate: null,
    surprisePercent: null
  };

  if (!Array.isArray(payload) || payload.length === 0) {
    return empty;
  }

  for (const row of payload) {
    if (typeof row !== "object" || row === null) {
      continue;
    }

    const record = row as Record<string, unknown>;
    const actual = toNumber(record.actual);
    const estimate = toNumber(record.estimate);

    if (actual === null && estimate === null) {
      continue;
    }

    const directSurprisePercent = toNumber(record.surprisePercent);
    const calculatedSurprisePercent =
      directSurprisePercent ??
      (actual !== null && estimate !== null && estimate !== 0
        ? ((actual - estimate) / Math.abs(estimate)) * 100
        : null);

    return {
      actual,
      estimate,
      period: typeof record.period === "string" ? record.period : null,
      reportDate: toStringValue(record.date) ?? toStringValue(record.period),
      surprisePercent: calculatedSurprisePercent
    };
  }

  return empty;
}

/**
 * Parses options flow payload into aggregated put/call metrics.
 *
 * @param payload Option-chain payload.
 * @returns Parsed put/call ratio and volume totals.
 */
function parseOptionFlow(payload: unknown): FinnhubOptionFlow {
  if (typeof payload !== "object" || payload === null) {
    return {
      putCallRatio: null,
      totalCallVolume: null,
      totalPutVolume: null,
      source: null
    };
  }

  const record = payload as Record<string, unknown>;

  let putCallRatio = firstNumeric(record, [
    "putCallRatio",
    "put_call_ratio",
    "pcr",
    "pcRatio",
    "putCallVolumeRatio",
    "putCall"
  ]);

  let totalCallVolume = firstNumeric(record, [
    "totalCallVolume",
    "callVolume",
    "callsVolume",
    "callOpenInterest",
    "totalCallOpenInterest"
  ]);

  let totalPutVolume = firstNumeric(record, [
    "totalPutVolume",
    "putVolume",
    "putsVolume",
    "putOpenInterest",
    "totalPutOpenInterest"
  ]);

  const rows =
    (Array.isArray(record.data) && record.data) ||
    (Array.isArray(record.optionChain) && record.optionChain) ||
    (Array.isArray(record.chain) && record.chain) ||
    [];

  if (rows.length > 0) {
    let rowCallSum = 0;
    let rowPutSum = 0;
    let hasCall = false;
    let hasPut = false;

    for (const row of rows) {
      if (typeof row !== "object" || row === null) {
        continue;
      }

      const rowRecord = row as Record<string, unknown>;

      const call = firstNumeric(rowRecord, [
        "callVolume",
        "totalCallVolume",
        "volumeCall",
        "callOpenInterest",
        "callOI"
      ]);
      const put = firstNumeric(rowRecord, [
        "putVolume",
        "totalPutVolume",
        "volumePut",
        "putOpenInterest",
        "putOI"
      ]);

      if (call !== null && call >= 0) {
        rowCallSum += call;
        hasCall = true;
      }

      if (put !== null && put >= 0) {
        rowPutSum += put;
        hasPut = true;
      }

      if (putCallRatio === null) {
        const rowRatio = firstNumeric(rowRecord, [
          "putCallRatio",
          "pcr",
          "pcRatio",
          "putCallVolumeRatio"
        ]);

        if (rowRatio !== null && rowRatio >= 0) {
          putCallRatio = rowRatio;
        }
      }
    }

    if (totalCallVolume === null && hasCall) {
      totalCallVolume = rowCallSum;
    }

    if (totalPutVolume === null && hasPut) {
      totalPutVolume = rowPutSum;
    }
  }

  if (putCallRatio === null && totalCallVolume !== null && totalPutVolume !== null && totalCallVolume > 0) {
    putCallRatio = totalPutVolume / totalCallVolume;
  }

  if (putCallRatio !== null && (!Number.isFinite(putCallRatio) || putCallRatio < 0)) {
    putCallRatio = null;
  }

  const source = putCallRatio !== null || totalCallVolume !== null || totalPutVolume !== null ? "FINNHUB" : null;

  return {
    putCallRatio,
    totalCallVolume,
    totalPutVolume,
    source
  };
}

/**
 * Converts recommendation trends to a normalized sentiment signal.
 *
 * @param rows Recommendation payload rows.
 * @returns Bullish/bearish score buckets.
 */
function recommendationSignal(rows: FinnhubRecommendationRow[] | null): FinnhubSentimentSignal {
  if (!rows || rows.length === 0) {
    return { bullishCount: 0, bearishCount: 0 };
  }

  const latest =
    [...rows].filter((row) => typeof row.period === "string").sort((a, b) => String(b.period).localeCompare(String(a.period)))[0] ??
    rows[0];

  const bullish = (latest.strongBuy ?? 0) + (latest.buy ?? 0);
  const bearish = (latest.strongSell ?? 0) + (latest.sell ?? 0);

  if (bullish > bearish) {
    return { bullishCount: 2, bearishCount: 0 };
  }

  if (bearish > bullish) {
    return { bullishCount: 0, bearishCount: 2 };
  }

  return { bullishCount: 0, bearishCount: 0 };
}

/**
 * Converts news sentiment payload to a normalized sentiment signal.
 *
 * @param news News-sentiment payload.
 * @returns Bullish/bearish score buckets.
 */
function newsSignal(news: FinnhubNewsSentiment | null): FinnhubSentimentSignal {
  if (!news) {
    return { bullishCount: 0, bearishCount: 0 };
  }

  const bullishPercent = news.sentiment?.bullishPercent ?? null;
  const bearishPercent = news.sentiment?.bearishPercent ?? null;
  const score = typeof news.companyNewsScore === "number" ? news.companyNewsScore : null;

  if ((typeof bullishPercent === "number" && bullishPercent >= 0.55) || (typeof score === "number" && score >= 0.15)) {
    return { bullishCount: 1, bearishCount: 0 };
  }

  if ((typeof bearishPercent === "number" && bearishPercent >= 0.45) || (typeof score === "number" && score <= -0.15)) {
    return { bullishCount: 0, bearishCount: 1 };
  }

  return { bullishCount: 0, bearishCount: 0 };
}

/**
 * Fetches combined recommendation and news sentiment signal.
 *
 * @param symbol Input ticker symbol.
 * @returns Aggregated sentiment counts.
 */
export async function fetchFinnhubSentiment(symbol: string): Promise<FinnhubSentimentSignal> {
  if (!isFinnhubConfigured()) {
    return { bullishCount: 0, bearishCount: 0 };
  }

  const [recommendation, news] = await Promise.all([
    fetchFinnhub<FinnhubRecommendationRow[]>("stock/recommendation", { symbol }),
    fetchFinnhub<FinnhubNewsSentiment>("news-sentiment", { symbol })
  ]);

  const rec = recommendationSignal(recommendation);
  const newsSentiment = newsSignal(news);

  return {
    bullishCount: Math.min(3, rec.bullishCount + newsSentiment.bullishCount),
    bearishCount: Math.min(3, rec.bearishCount + newsSentiment.bearishCount)
  };
}

/**
 * Fetches ticker-level options flow snapshot.
 *
 * @param symbol Input ticker symbol.
 * @returns Parsed option flow metrics.
 */
export async function fetchFinnhubOptionFlow(symbol: string): Promise<FinnhubOptionFlow> {
  if (!isFinnhubConfigured()) {
    return {
      putCallRatio: null,
      totalCallVolume: null,
      totalPutVolume: null,
      source: null
    };
  }

  const payload = await fetchFinnhub<unknown>("stock/option-chain", { symbol });
  return parseOptionFlow(payload);
}

/**
 * Fetches current quote price.
 *
 * @param symbol Input ticker symbol.
 * @returns Positive current price or null.
 */
export async function fetchFinnhubQuotePrice(symbol: string): Promise<number | null> {
  if (!isFinnhubConfigured()) {
    return null;
  }

  const payload = await fetchFinnhub<Record<string, unknown>>("quote", { symbol });
  if (!payload) {
    return null;
  }

  const current = toNumber(payload.c);
  if (current === null || current <= 0) {
    return null;
  }

  return current;
}

/**
 * Fetches quote snapshot with percent change and timestamp.
 *
 * @param symbol Input ticker symbol.
 * @returns Quote snapshot structure.
 */
export async function fetchFinnhubQuoteSnapshot(symbol: string): Promise<FinnhubQuoteSnapshot> {
  if (!isFinnhubConfigured()) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const payload = await fetchFinnhub<Record<string, unknown>>("quote", { symbol });
  if (!payload) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const price = toNumber(payload.c);
  const changePercent = toNumber(payload.dp);
  const rawTs = toNumber(payload.t);
  const asOfMs = rawTs !== null && rawTs > 0 ? Math.round(rawTs * 1000) : null;

  return {
    price: price !== null && price > 0 ? price : null,
    changePercent,
    asOfMs
  };
}

/**
 * Fetches company profile fields used for sector/industry normalization.
 *
 * @param symbol Input ticker symbol.
 * @returns Profile with sector and industry hints.
 */
export async function fetchFinnhubCompanyProfile(symbol: string): Promise<FinnhubCompanyProfile> {
  if (!isFinnhubConfigured()) {
    return {
      sector: null,
      industry: null,
      shareOutstanding: null
    };
  }

  const payload = await fetchFinnhub<Record<string, unknown>>("stock/profile2", { symbol });

  if (!payload) {
    return {
      sector: null,
      industry: null,
      shareOutstanding: null
    };
  }

  const shareOutstandingRaw =
    toNumber(payload.shareOutstanding) ??
    toNumber(payload.sharesOutstanding) ??
    toNumber(payload.totalSharesOutstanding);

  const shareOutstanding =
    shareOutstandingRaw !== null && shareOutstandingRaw > 0
      ? shareOutstandingRaw <= 500_000
        ? shareOutstandingRaw * 1_000_000
        : shareOutstandingRaw
      : null;

  return {
    sector: toStringValue(payload.gsector) ?? toStringValue(payload.sector),
    industry:
      toStringValue(payload.gind) ??
      toStringValue(payload.finnhubIndustry) ??
      toStringValue(payload.industry),
    shareOutstanding
  };
}

/**
 * Fetches full Finnhub metrics payload used by metrics extractor.
 *
 * @param symbol Input ticker symbol.
 * @returns Raw metric payload or null.
 */
export async function fetchFinnhubMetrics(symbol: string): Promise<unknown> {
  if (!isFinnhubConfigured()) {
    return null;
  }

  const payload = await fetchFinnhub<unknown>("stock/metric", { symbol, metric: "all" });
  return payload;
}

/**
 * Aggregates 90-day insider transaction flow into a net-share signal.
 *
 * @param symbol Input ticker symbol.
 * @returns Net/buy/sell insider shares over trailing 90 days.
 */
export async function fetchFinnhubInsiderSignal(symbol: string): Promise<FinnhubInsiderSignal> {
  if (!isFinnhubConfigured()) {
    return {
      netChangeShares90d: null,
      buyShares90d: 0,
      sellShares90d: 0,
      transactionCount90d: 0
    };
  }

  const payload = await fetchFinnhub<unknown>("stock/insider-transactions", { symbol });
  if (typeof payload !== "object" || payload === null) {
    return {
      netChangeShares90d: null,
      buyShares90d: 0,
      sellShares90d: 0,
      transactionCount90d: 0
    };
  }

  const rows = Array.isArray((payload as Record<string, unknown>).data)
    ? ((payload as Record<string, unknown>).data as unknown[])
    : [];
  const cutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;

  let netChangeShares90d = 0;
  let buyShares90d = 0;
  let sellShares90d = 0;
  let transactionCount90d = 0;

  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const dateText = toStringValue(row.transactionDate) ?? toStringValue(row.filingDate);
    if (!dateText) {
      continue;
    }

    const dateMs = Date.parse(dateText);
    if (!Number.isFinite(dateMs) || dateMs < cutoffMs) {
      continue;
    }

    const change = toNumber(row.change);
    if (change === null || !Number.isFinite(change)) {
      continue;
    }

    netChangeShares90d += change;
    if (change > 0) {
      buyShares90d += change;
    } else if (change < 0) {
      sellShares90d += Math.abs(change);
    }
    transactionCount90d += 1;
  }

  return {
    netChangeShares90d: transactionCount90d > 0 ? netChangeShares90d : null,
    buyShares90d,
    sellShares90d,
    transactionCount90d
  };
}

/**
 * Fetches recent company headlines from Finnhub.
 *
 * @param symbol Input ticker symbol.
 * @param days Lookback window in calendar days.
 * @param limit Maximum headline count.
 * @returns Recent company news items.
 */
export async function fetchFinnhubCompanyNews(symbol: string, days = 14, limit = 5): Promise<FinnhubCompanyNewsItem[]> {
  if (!isFinnhubConfigured()) {
    return [];
  }

  const to = new Date();
  const from = new Date(to.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);

  const payload = await fetchFinnhub<unknown[]>("company-news", {
    symbol,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  });

  if (!Array.isArray(payload)) {
    return [];
  }

  const parsed: FinnhubCompanyNewsItem[] = [];

  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const headline = toStringValue(row.headline);
    if (!headline) {
      continue;
    }

    parsed.push({
      headline,
      url: toStringValue(row.url),
      source: toStringValue(row.source),
      datetime: toNumber(row.datetime)
    });
  }

  return parsed
    .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
    .slice(0, Math.max(1, limit));
}

/**
 * Fetches most recent earnings rows and returns latest populated snapshot.
 *
 * @param symbol Input ticker symbol.
 * @returns Latest earnings snapshot.
 */
export async function fetchFinnhubLatestEarnings(symbol: string): Promise<FinnhubEarningsSnapshot> {
  if (!isFinnhubConfigured()) {
    return {
      actual: null,
      estimate: null,
      period: null,
      reportDate: null,
      surprisePercent: null
    };
  }

  const payload = await fetchFinnhub<unknown>("stock/earnings", { symbol, limit: "8" });
  return parseLatestEarnings(payload);
}

/**
 * Fetches earnings calendar entries for a date window.
 *
 * @param from Inclusive start date (YYYY-MM-DD).
 * @param to Inclusive end date (YYYY-MM-DD).
 * @param symbols Optional list of symbols to include.
 * @returns Normalized earnings calendar items.
 */
export async function fetchFinnhubEarningsCalendar(
  from: string,
  to: string,
  symbols: string[] = []
): Promise<FinnhubEarningsCalendarItem[]> {
  if (!isFinnhubConfigured()) {
    return [];
  }

  const query: Record<string, string> = { from, to };
  // Finnhub earnings calendar supports a single symbol filter; for multi-symbol coverage,
  // request broad calendar data and filter client-side.
  if (symbols.length === 1 && symbols[0]) {
    query.symbol = symbols[0];
  }

  const payload = await fetchFinnhub<unknown>("calendar/earnings", query);

  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const rows = Array.isArray(record.earningsCalendar) ? record.earningsCalendar : [];
  const parsed: FinnhubEarningsCalendarItem[] = [];

  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const symbol = toStringValue(row.symbol);
    if (!symbol) {
      continue;
    }

    const epsActual = toNumber(row.epsActual);
    const epsEstimate = toNumber(row.epsEstimate);
    const explicitSurprise = toNumber(row.surprisePercent) ?? toNumber(row.surprise);
    const calculatedSurprise =
      explicitSurprise ??
      (epsActual !== null && epsEstimate !== null && epsEstimate !== 0
        ? ((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100
        : null);

    const quarterNumeric = toNumber(row.quarter);
    const yearNumeric = toNumber(row.year);
    const periodParts: string[] = [];
    if (quarterNumeric !== null) {
      periodParts.push(`Q${Math.round(quarterNumeric)}`);
    } else {
      const quarterString = toStringValue(row.quarter);
      if (quarterString) {
        periodParts.push(quarterString);
      }
    }

    if (yearNumeric !== null) {
      periodParts.push(String(Math.round(yearNumeric)));
    } else {
      const yearString = toStringValue(row.year);
      if (yearString) {
        periodParts.push(yearString);
      }
    }

    parsed.push({
      symbol,
      date: toStringValue(row.date),
      period: periodParts.length > 0 ? periodParts.join(" ") : null,
      epsActual,
      epsEstimate,
      surprisePercent: calculatedSurprise,
      revenueEstimate: toNumber(row.revenueEstimate)
    });
  }

  return parsed;
}
