import {
  fetchJsonOrNull,
  parseOptionalNumber,
  parseOptionalString,
  parseTimestampMs,
  readEnvToken,
  setUrlSearchParams,
  toRecord
} from "@/lib/market/adapter-utils";
import { normalizeRatio } from "@/lib/utils";

export interface EodhdFallbackData {
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
  freeCashflow: number | null;
  quoteTimestampMs: number | null;
  articleCount: number;
}

export interface EodhdQuoteSnapshot {
  price: number | null;
  asOfMs: number | null;
}

const EODHD_BASE_URL = "https://eodhd.com/api";
const EODHD_FETCH_TIMEOUT_MS = 4_500;

/**
 * Reads the configured EODHD API key from env.
 *
 * @returns API key when configured, else null.
 */
function eodhdApiKey(): string | null {
  return readEnvToken("EODHD_API_KEY");
}

/**
 * Indicates whether EODHD integration is configured.
 *
 * @returns True when a non-empty API key is present.
 */
export function isEodhdConfigured(): boolean {
  return eodhdApiKey() !== null;
}

/**
 * Normalizes tickers to EODHD exchange format.
 *
 * @param symbol Input ticker symbol.
 * @returns Uppercase symbol with default ".US" suffix when missing exchange.
 */
function eodSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  return normalized.includes(".") ? normalized : `${normalized}.US`;
}

/**
 * Parses a numeric payload field from EODHD responses.
 *
 * @param value Unknown payload field.
 * @returns Finite number or null when invalid.
 */
function asNumber(value: unknown): number | null {
  return parseOptionalNumber(value, { allowCommas: true });
}

/**
 * Parses an optional non-empty string from payload values.
 *
 * @param value Unknown payload field.
 * @returns Trimmed string or null.
 */
function asString(value: unknown): string | null {
  return parseOptionalString(value);
}

/**
 * Safely narrows unknown payload objects.
 *
 * @param record Unknown value.
 * @returns Key/value record or empty object.
 */
function fromRecord(record: unknown): Record<string, unknown> {
  return toRecord(record);
}

/**
 * Performs an EODHD GET request with standard auth/query params.
 *
 * @param path API path relative to EODHD base URL.
 * @param params Additional query parameters.
 * @returns Parsed JSON payload or null when request fails.
 */
async function fetchEodhd<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = eodhdApiKey();

  if (!apiKey) {
    return null;
  }

  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(`${EODHD_BASE_URL}/${normalizedPath}`);
  setUrlSearchParams(url, {
    api_token: apiKey,
    fmt: "json",
    ...params
  });

  return fetchJsonOrNull<T>(url, {
    timeoutMs: EODHD_FETCH_TIMEOUT_MS,
    revalidateSeconds: 300,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*"
    },
    isInvalidPayload: (payload) => {
      if (typeof payload !== "object" || payload === null) return false;
      const record = payload as Record<string, unknown>;
      return typeof record.message === "string" || typeof record.error === "string";
    }
  });
}

/**
 * Extracts the best-effort quote price from EODHD quote payloads.
 *
 * @param payload Quote-like payload.
 * @returns Positive price or null.
 */
function extractQuotePrice(payload: unknown): number | null {
  const record = fromRecord(payload);
  return (
    asNumber(record.close) ??
    asNumber(record.last) ??
    asNumber(record.price) ??
    asNumber(record.adjusted_close) ??
    asNumber(record.previousClose)
  );
}

/**
 * Extracts quote timestamp in milliseconds from EODHD payloads.
 *
 * @param payload Quote-like payload.
 * @returns Epoch milliseconds or null.
 */
function extractQuoteTimestampMs(payload: unknown): number | null {
  const record = fromRecord(payload);
  const raw =
    asNumber(record.timestamp) ??
    asNumber(record.last_time) ??
    asNumber(record.time) ??
    asNumber(record.updated) ??
    asNumber(record.updated_at);

  return parseTimestampMs(raw);
}

/**
 * Creates the empty EODHD fallback payload shape.
 *
 * @returns Null-initialized fallback data.
 */
function emptyFallback(): EodhdFallbackData {
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
    freeCashflow: null,
    quoteTimestampMs: null,
    articleCount: 0
  };
}

/**
 * Fetches a lightweight EODHD quote snapshot.
 *
 * @param symbol Input ticker symbol.
 * @returns Latest quote price and timestamp.
 */
export async function fetchEodhdQuoteSnapshot(symbol: string): Promise<EodhdQuoteSnapshot> {
  if (!isEodhdConfigured()) {
    return { price: null, asOfMs: null };
  }

  const quote = await fetchEodhd<unknown>(`real-time/${encodeURIComponent(eodSymbol(symbol))}`);
  return {
    price: extractQuotePrice(quote),
    asOfMs: extractQuoteTimestampMs(quote)
  };
}

/**
 * Fetches only quote price from EODHD.
 *
 * @param symbol Input ticker symbol.
 * @returns Latest positive price or null.
 */
export async function fetchEodhdQuotePrice(symbol: string): Promise<number | null> {
  const snapshot = await fetchEodhdQuoteSnapshot(symbol);
  return snapshot.price;
}

/**
 * Fetches EODHD fundamentals plus quote fallback fields for model inputs.
 *
 * @param symbol Input ticker symbol.
 * @returns Provider fallback payload with normalized ratios where applicable.
 */
export async function fetchEodhdFallbackData(symbol: string): Promise<EodhdFallbackData> {
  if (!isEodhdConfigured()) {
    return emptyFallback();
  }

  const resolved = eodSymbol(symbol);
  const [fundamentalsPayload, quotePayload] = await Promise.all([
    fetchEodhd<unknown>(`fundamentals/${encodeURIComponent(resolved)}`),
    fetchEodhd<unknown>(`real-time/${encodeURIComponent(resolved)}`)
  ]);

  const fundamentals = fromRecord(fundamentalsPayload);
  const general = fromRecord(fundamentals.General);
  const highlights = fromRecord(fundamentals.Highlights);
  const valuation = fromRecord(fundamentals.Valuation);
  const financials = fromRecord(fundamentals.Financials);
  const cashFlow = fromRecord(financials.Cash_Flow);
  const yearlyCashFlow = fromRecord(cashFlow.yearly);
  const quarterlyCashFlow = fromRecord(cashFlow.quarterly);
  const quote = fromRecord(quotePayload);

  const yearlyRows = Object.values(yearlyCashFlow).filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null
  );
  const quarterlyRows = Object.values(quarterlyCashFlow).filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null
  );
  const latestCashflowRow = yearlyRows[0] ?? quarterlyRows[0] ?? {};

  const freeCashflow =
    asNumber(highlights.FreeCashFlowTTM) ??
    asNumber(highlights.FreeCashFlow) ??
    asNumber(latestCashflowRow.freeCashFlow) ??
    asNumber(latestCashflowRow.free_cash_flow);

  return {
    companyName: asString(general.Name) ?? asString(general.Code),
    sector: asString(general.Sector),
    industry: asString(general.Industry),
    currency: asString(general.CurrencyCode) ?? asString(general.CurrencyName),
    marketCap: asNumber(highlights.MarketCapitalization) ?? asNumber(quote.market_cap),
    currentPrice: extractQuotePrice(quotePayload),
    forwardPE:
      asNumber(valuation.ForwardPE) ??
      asNumber(highlights.ForwardPE) ??
      asNumber(highlights.PERatio),
    debtToEquity: normalizeRatio(asNumber(highlights.DebtToEquity)),
    profitMargin: normalizeRatio(asNumber(highlights.ProfitMargin)),
    revenueGrowth: normalizeRatio(
      asNumber(highlights.QuarterlyRevenueGrowthYOY) ??
      asNumber(highlights.RevenueGrowth) ??
      asNumber(highlights.SalesGrowth)
    ),
    freeCashflow,
    quoteTimestampMs: extractQuoteTimestampMs(quotePayload),
    articleCount: 0
  };
}
