import {
  fetchJsonOrNull,
  parseApiKeyList,
  parseOptionalNumber,
  parseTimestampMs,
  readEnvToken
} from "@/lib/market/adapter-utils";

export interface MassiveOptionFlow {
  putCallRatio: number | null;
  totalCallVolume: number | null;
  totalPutVolume: number | null;
  source: string | null;
}

export interface MassiveShortInterest {
  shortInterestShares: number | null;
  settlementDate: string | null;
  source: string | null;
}

export interface MassiveQuoteSnapshot {
  price: number | null;
  asOfMs: number | null;
}

const MASSIVE_BASE_URLS = ["https://api.massive.com", "https://api.polygon.io"];
const MAX_CHAIN_PAGES = 6;
const CHAIN_PAGE_LIMIT = 250;
const MASSIVE_FETCH_TIMEOUT_MS = 4_500;

/**
 * Parses numeric values from Massive payloads.
 *
 * @param value Unknown input.
 * @returns Finite number or null.
 */
function parseNumber(value: unknown): number | null {
  return parseOptionalNumber(value);
}

/**
 * Parses and validates Massive API key candidates from environment config.
 *
 * @returns Unique validated Massive API keys.
 */
export function getMassiveApiKeys(): string[] {
  const raw = readEnvToken("MASSIVE_API_KEY") ?? "";

  return parseApiKeyList(raw, {
    minLength: 24,
    tokenPattern: /^[A-Za-z0-9_\-]+$/,
    concatenated: {
      minRawLength: 24,
      chunkLengths: [32, 34, 36, 40]
    }
  });
}

/**
 * Indicates whether Massive/Polygon integration is configured.
 *
 * @returns True when at least one key is available.
 */
export function isMassiveConfigured(): boolean {
  return getMassiveApiKeys().length > 0;
}

interface MassiveChainRow {
  day?: {
    volume?: number;
  };
  details?: {
    contract_type?: string;
    contractType?: string;
  };
  open_interest?: number;
  openInterest?: number;
  volume?: number;
}

interface MassiveChainResponse {
  results?: MassiveChainRow[];
  next_url?: string;
}

interface MassiveDirectSnapshotResponse {
  puts?: Array<Record<string, unknown>>;
  calls?: Array<Record<string, unknown>>;
  results?: {
    puts?: Array<Record<string, unknown>>;
    calls?: Array<Record<string, unknown>>;
  };
}

interface MassiveShortInterestRow {
  settlement_date?: string;
  short_interest?: number;
}

interface MassiveShortInterestResponse {
  results?: MassiveShortInterestRow[];
}

/**
 * Normalizes provider contract type values.
 *
 * @param raw Raw contract type string.
 * @returns "call", "put", or null.
 */
function normalizeContractType(raw: unknown): "call" | "put" | null {
  if (typeof raw !== "string") {
    return null;
  }

  const value = raw.toLowerCase();
  if (value.includes("call")) return "call";
  if (value.includes("put")) return "put";
  return null;
}

/**
 * Performs JSON fetch against Massive/Polygon endpoints.
 *
 * @param url Fully-qualified endpoint URL.
 * @returns Parsed payload or null when request fails.
 */
async function fetchMassiveJson<T>(url: string): Promise<T | null> {
  return fetchJsonOrNull<T>(url, {
    timeoutMs: MASSIVE_FETCH_TIMEOUT_MS,
    revalidateSeconds: 120,
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });
}

/**
 * Sums contract-side volume/open-interest from option snapshot rows.
 *
 * @param rows Option-side rows.
 * @returns Aggregated volume and open-interest totals.
 */
function sumContractSide(
  rows: Array<Record<string, unknown>> | undefined
): { volume: number | null; openInterest: number | null } {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { volume: null, openInterest: null };
  }

  let volumeTotal = 0;
  let openInterestTotal = 0;
  let hasVolume = false;
  let hasOpenInterest = false;

  for (const row of rows) {
    const day = (typeof row.day === "object" && row.day !== null ? row.day : {}) as Record<string, unknown>;
    const volume =
      parseNumber(day.volume) ??
      parseNumber(row.volume) ??
      parseNumber((row as Record<string, unknown>).dayVolume);
    if (volume !== null && volume >= 0) {
      volumeTotal += volume;
      hasVolume = true;
    }

    const oi =
      parseNumber(row.open_interest) ??
      parseNumber(row.openInterest) ??
      parseNumber(row.open_interest_change) ??
      parseNumber((row as Record<string, unknown>).oi);
    if (oi !== null && oi >= 0) {
      openInterestTotal += oi;
      hasOpenInterest = true;
    }
  }

  return {
    volume: hasVolume ? volumeTotal : null,
    openInterest: hasOpenInterest ? openInterestTotal : null
  };
}

/**
 * Converts direct option snapshot payload into put/call flow metrics.
 *
 * @param payload Direct snapshot payload.
 * @returns Parsed flow or null when no usable data exists.
 */
function parseDirectSnapshotFlow(payload: MassiveDirectSnapshotResponse | null): MassiveOptionFlow | null {
  if (!payload) {
    return null;
  }

  const puts = payload.puts ?? payload.results?.puts;
  const calls = payload.calls ?? payload.results?.calls;

  const putSide = sumContractSide(puts);
  const callSide = sumContractSide(calls);

  const hasVolume = putSide.volume !== null && callSide.volume !== null && callSide.volume > 0;
  if (hasVolume) {
    const putVolume = putSide.volume as number;
    const callVolume = callSide.volume as number;

    return {
      putCallRatio: putVolume / callVolume,
      totalCallVolume: callVolume,
      totalPutVolume: putVolume,
      source: "MASSIVE_VOLUME"
    };
  }

  const hasOpenInterest = putSide.openInterest !== null && callSide.openInterest !== null && callSide.openInterest > 0;
  if (hasOpenInterest) {
    const putOpenInterest = putSide.openInterest as number;
    const callOpenInterest = callSide.openInterest as number;

    return {
      putCallRatio: putOpenInterest / callOpenInterest,
      totalCallVolume: callOpenInterest,
      totalPutVolume: putOpenInterest,
      source: "MASSIVE_OPEN_INTEREST"
    };
  }

  return null;
}

/**
 * Builds direct option snapshot URL.
 *
 * @param baseUrl Massive/Polygon base URL.
 * @param symbol Ticker symbol.
 * @param apiKey API key.
 * @returns Fully-qualified URL.
 */
function buildDirectSnapshotUrl(baseUrl: string, symbol: string, apiKey: string): string {
  const url = new URL(`${baseUrl}/v3/snapshot/options/${encodeURIComponent(symbol)}`);
  // Massive examples commonly use lowercase "apikey"; keep both for compatibility.
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

/**
 * Builds paged option-chain URL for a single contract side.
 *
 * @param baseUrl Massive/Polygon base URL.
 * @param symbol Ticker symbol.
 * @param contractType Option side.
 * @param apiKey API key.
 * @returns Fully-qualified URL.
 */
function buildInitialChainUrl(baseUrl: string, symbol: string, contractType: "call" | "put", apiKey: string): string {
  const url = new URL(`${baseUrl}/v3/snapshot/options/${encodeURIComponent(symbol)}`);
  url.searchParams.set("contract_type", contractType);
  url.searchParams.set("limit", String(CHAIN_PAGE_LIMIT));
  url.searchParams.set("sort", "expiration_date");
  url.searchParams.set("order", "asc");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

/**
 * Builds short-interest endpoint URL.
 *
 * @param baseUrl Massive/Polygon base URL.
 * @param symbol Ticker symbol.
 * @param apiKey API key.
 * @returns Fully-qualified URL.
 */
function buildShortInterestUrl(baseUrl: string, symbol: string, apiKey: string): string {
  const url = new URL(`${baseUrl}/stocks/v1/short-interest`);
  url.searchParams.set("ticker", symbol);
  // 250 records generally covers full modern history for one ticker.
  url.searchParams.set("limit", "250");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

/**
 * Builds stock snapshot URL.
 *
 * @param baseUrl Massive/Polygon base URL.
 * @param symbol Ticker symbol.
 * @param apiKey API key.
 * @returns Fully-qualified URL.
 */
function buildSnapshotTickerUrl(baseUrl: string, symbol: string, apiKey: string): string {
  const url = new URL(`${baseUrl}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

/**
 * Builds last-trade endpoint URL.
 *
 * @param baseUrl Massive/Polygon base URL.
 * @param symbol Ticker symbol.
 * @param apiKey API key.
 * @returns Fully-qualified URL.
 */
function buildLastTradeUrl(baseUrl: string, symbol: string, apiKey: string): string {
  const url = new URL(`${baseUrl}/v2/last/trade/${encodeURIComponent(symbol)}`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

/**
 * Extracts quote price from Massive snapshot/last-trade payloads.
 *
 * @param payload Unknown quote payload.
 * @returns Positive price or null.
 */
function extractMassiveQuotePrice(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const results =
    typeof record.results === "object" && record.results !== null
      ? (record.results as Record<string, unknown>)
      : null;
  const ticker =
    typeof record.ticker === "object" && record.ticker !== null
      ? (record.ticker as Record<string, unknown>)
      : null;
  const day =
    ticker && typeof ticker.day === "object" && ticker.day !== null
      ? (ticker.day as Record<string, unknown>)
      : null;
  const minute =
    ticker && typeof ticker.min === "object" && ticker.min !== null
      ? (ticker.min as Record<string, unknown>)
      : null;
  const lastTrade =
    ticker && typeof ticker.lastTrade === "object" && ticker.lastTrade !== null
      ? (ticker.lastTrade as Record<string, unknown>)
      : null;

  const price =
    parseNumber(results?.p) ??
    parseNumber(results?.price) ??
    parseNumber(lastTrade?.p) ??
    parseNumber(lastTrade?.price) ??
    parseNumber(day?.c) ??
    parseNumber(minute?.c);

  return price !== null && price > 0 ? price : null;
}

/**
 * Extracts quote timestamp from Massive snapshot/last-trade payloads.
 *
 * @param payload Unknown quote payload.
 * @returns Epoch milliseconds or null.
 */
function extractMassiveQuoteTimestampMs(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const results =
    typeof record.results === "object" && record.results !== null
      ? (record.results as Record<string, unknown>)
      : null;
  const ticker =
    typeof record.ticker === "object" && record.ticker !== null
      ? (record.ticker as Record<string, unknown>)
      : null;
  const lastTrade =
    ticker && typeof ticker.lastTrade === "object" && ticker.lastTrade !== null
      ? (ticker.lastTrade as Record<string, unknown>)
      : null;

  const raw =
    parseNumber(results?.t) ??
    parseNumber(lastTrade?.t) ??
    parseNumber(record.updated) ??
    parseNumber(record.timestamp);

  return parseTimestampMs(raw);
}

/**
 * Ensures paged URLs always include API key credentials.
 *
 * @param nextUrl Provider "next" URL.
 * @param baseUrl Base URL for resolution.
 * @param apiKey API key.
 * @returns URL with auth params attached.
 */
function attachApiKey(nextUrl: string, baseUrl: string, apiKey: string): string {
  const url = new URL(nextUrl, baseUrl);
  if (!url.searchParams.has("apiKey") && !url.searchParams.has("apikey")) {
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("apiKey", apiKey);
  }
  return url.toString();
}

/**
 * Aggregates a paged option-chain side into total volume/open-interest.
 *
 * @param baseUrl Massive/Polygon base URL.
 * @param apiKey API key.
 * @param symbol Ticker symbol.
 * @param contractType Side to aggregate.
 * @returns Aggregated side totals.
 */
async function aggregateChainSide(
  baseUrl: string,
  apiKey: string,
  symbol: string,
  contractType: "call" | "put"
): Promise<{ volume: number | null; openInterest: number | null }> {
  let url: string | null = buildInitialChainUrl(baseUrl, symbol, contractType, apiKey);
  let pages = 0;
  let volumeTotal = 0;
  let openInterestTotal = 0;
  let hasVolume = false;
  let hasOpenInterest = false;

  while (url && pages < MAX_CHAIN_PAGES) {
    const payload = await fetchMassiveJson<MassiveChainResponse>(url);

    if (!payload) {
      break;
    }

    const rows = Array.isArray(payload.results) ? payload.results : [];

    for (const row of rows) {
      const rowContractType =
        normalizeContractType(row.details?.contract_type) ??
        normalizeContractType(row.details?.contractType);

      if (rowContractType && rowContractType !== contractType) {
        continue;
      }

      const volume = parseNumber(row.day?.volume) ?? parseNumber(row.volume);
      if (volume !== null && volume >= 0) {
        volumeTotal += volume;
        hasVolume = true;
      }

      const oi = parseNumber(row.open_interest) ?? parseNumber(row.openInterest);
      if (oi !== null && oi >= 0) {
        openInterestTotal += oi;
        hasOpenInterest = true;
      }
    }

    if (typeof payload.next_url === "string" && payload.next_url.length > 0) {
      url = attachApiKey(payload.next_url, baseUrl, apiKey);
    } else {
      url = null;
    }

    pages += 1;
  }

  return {
    volume: hasVolume ? volumeTotal : null,
    openInterest: hasOpenInterest ? openInterestTotal : null
  };
}

/**
 * Fetches put/call flow from Massive/Polygon direct snapshot endpoints.
 *
 * @param symbol Input ticker symbol.
 * @returns Option flow metrics.
 */
export async function fetchMassiveOptionFlow(symbol: string): Promise<MassiveOptionFlow> {
  if (!isMassiveConfigured()) {
    return {
      putCallRatio: null,
      totalCallVolume: null,
      totalPutVolume: null,
      source: null
    };
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const tokens = getMassiveApiKeys();

  for (const token of tokens) {
    for (const baseUrl of MASSIVE_BASE_URLS) {
      const directPayload = await fetchMassiveJson<MassiveDirectSnapshotResponse>(
        buildDirectSnapshotUrl(baseUrl, normalizedSymbol, token)
      );
      const directFlow = parseDirectSnapshotFlow(directPayload);
      if (directFlow) {
        return directFlow;
      }
    }
  }

  return {
    putCallRatio: null,
    totalCallVolume: null,
    totalPutVolume: null,
    source: null
  };
}

/**
 * Fetches latest short-interest record from Massive/Polygon.
 *
 * @param symbol Input ticker symbol.
 * @returns Latest short-interest snapshot.
 */
export async function fetchMassiveShortInterest(symbol: string): Promise<MassiveShortInterest> {
  if (!isMassiveConfigured()) {
    return {
      shortInterestShares: null,
      settlementDate: null,
      source: null
    };
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const tokens = getMassiveApiKeys();

  for (const token of tokens) {
    for (const baseUrl of MASSIVE_BASE_URLS) {
      const payload = await fetchMassiveJson<MassiveShortInterestResponse>(
        buildShortInterestUrl(baseUrl, normalizedSymbol, token)
      );

      const rows = Array.isArray(payload?.results) ? payload.results : [];
      if (rows.length === 0) {
        continue;
      }

      let latestDate: string | null = null;
      let latestShortInterest: number | null = null;

      for (const row of rows) {
        const settlementDate = typeof row.settlement_date === "string" ? row.settlement_date : null;
        const shortInterest = parseNumber(row.short_interest);
        if (!settlementDate || shortInterest === null || shortInterest < 0) {
          continue;
        }

        if (latestDate === null || settlementDate > latestDate) {
          latestDate = settlementDate;
          latestShortInterest = shortInterest;
        }
      }

      if (latestDate !== null && latestShortInterest !== null) {
        return {
          shortInterestShares: latestShortInterest,
          settlementDate: latestDate,
          source: "MASSIVE_SHORT_INTEREST"
        };
      }
    }
  }

  return {
    shortInterestShares: null,
    settlementDate: null,
    source: null
  };
}

/**
 * Fetches latest stock quote snapshot from Massive/Polygon.
 *
 * @param symbol Input ticker symbol.
 * @returns Quote snapshot.
 */
export async function fetchMassiveQuoteSnapshot(symbol: string): Promise<MassiveQuoteSnapshot> {
  if (!isMassiveConfigured()) {
    return { price: null, asOfMs: null };
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const tokens = getMassiveApiKeys();

  for (const token of tokens) {
    for (const baseUrl of MASSIVE_BASE_URLS) {
      const [snapshotPayload, lastTradePayload] = await Promise.all([
        fetchMassiveJson<unknown>(buildSnapshotTickerUrl(baseUrl, normalizedSymbol, token)),
        fetchMassiveJson<unknown>(buildLastTradeUrl(baseUrl, normalizedSymbol, token))
      ]);

      const snapshotPrice = extractMassiveQuotePrice(snapshotPayload);
      if (snapshotPrice !== null) {
        return {
          price: snapshotPrice,
          asOfMs: extractMassiveQuoteTimestampMs(snapshotPayload)
        };
      }

      const tradePrice = extractMassiveQuotePrice(lastTradePayload);
      if (tradePrice !== null) {
        return {
          price: tradePrice,
          asOfMs: extractMassiveQuoteTimestampMs(lastTradePayload)
        };
      }
    }
  }

  return { price: null, asOfMs: null };
}

/**
 * Fetches only latest quote price from Massive/Polygon.
 *
 * @param symbol Input ticker symbol.
 * @returns Positive price or null.
 */
export async function fetchMassiveQuotePrice(symbol: string): Promise<number | null> {
  const snapshot = await fetchMassiveQuoteSnapshot(symbol);
  return snapshot.price;
}
