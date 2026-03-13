import { fetchFmpEarningsCalendar, type FmpEarningsItem } from "@/lib/market/providers/fmp";
import { fetchFinnhubEarningsCalendar, type FinnhubEarningsCalendarItem } from "@/lib/market/providers/finnhub";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import { buildSp500SymbolUniverse } from "@/lib/market/universe/sp500-universe";
import { log } from "@/lib/logger";
import { publishEarnings } from "@/lib/realtime/publisher";

export const EARNINGS_CACHE_HEADER = "public, max-age=1800, s-maxage=21600, stale-while-revalidate=43200";
const EARNINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FALLBACK_EARNINGS_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "UNH"];

export interface EarningsUpcomingItem {
  symbol: string;
  companyName: string;
  date: string | null;
  epsEstimate: number | null;
}

export interface EarningsPassedItem {
  symbol: string;
  companyName: string;
  date: string | null;
  period: string | null;
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
  outcome: "beat" | "miss" | "inline" | "unknown";
}

export interface EarningsPayload {
  upcoming: EarningsUpcomingItem[];
  passed: EarningsPassedItem[];
}

interface NormalizedEarningsRow {
  symbol: string;
  date: string | null;
  period: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  source: "fmp" | "finnhub";
}

type EarningsServiceResult =
  | {
      ok: true;
      status: 200;
      payload: EarningsPayload;
      cacheControl: string;
    }
  | {
      ok: false;
      status: 500;
      error: string;
      cacheControl: string;
    };

let earningsCache: { expiresAt: number; payload: EarningsPayload } | null = null;

function normalizeTickerSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/-/g, ".");
}

function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDayEpoch(dateValue: string | null): number | null {
  if (!dateValue) return null;
  const epoch = Date.parse(`${dateValue}T00:00:00Z`);
  return Number.isFinite(epoch) ? epoch : null;
}

function outcomeFromSurprise(
  surprisePercent: number | null,
  actual: number | null,
  estimate: number | null
): EarningsPassedItem["outcome"] {
  const computed =
    surprisePercent ??
    (actual !== null && estimate !== null && estimate !== 0 ? ((actual - estimate) / Math.abs(estimate)) * 100 : null);
  if (computed === null) return "unknown";
  if (computed > 0) return "beat";
  if (computed < 0) return "miss";
  return "inline";
}

function hasUpcomingInfo(row: NormalizedEarningsRow): boolean {
  return row.date !== null && row.epsEstimate !== null;
}

function hasPassedInfo(row: NormalizedEarningsRow): boolean {
  return row.date !== null && row.epsActual !== null && row.epsEstimate !== null;
}

function nearestUniqueBySymbol<T extends { symbol: string }>(rows: T[], maxRows: number): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const row of rows) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    selected.push(row);
    if (selected.length >= maxRows) break;
  }
  return selected;
}

function sortUpcoming(rows: NormalizedEarningsRow[]): NormalizedEarningsRow[] {
  return [...rows].sort((left, right) => {
    const byDate = (left.date ?? "").localeCompare(right.date ?? "");
    if (byDate !== 0) return byDate;
    return left.symbol.localeCompare(right.symbol);
  });
}

function sortPassed(rows: NormalizedEarningsRow[]): NormalizedEarningsRow[] {
  return [...rows].sort((left, right) => {
    const byDate = (right.date ?? "").localeCompare(left.date ?? "");
    if (byDate !== 0) return byDate;
    return left.symbol.localeCompare(right.symbol);
  });
}

function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueEarningsRows(rows: NormalizedEarningsRow[]): NormalizedEarningsRow[] {
  const seen = new Set<string>();
  const out: NormalizedEarningsRow[] = [];

  for (const row of rows) {
    const key = `${row.symbol}|${row.date ?? ""}|${row.period ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

function normalizeFmpRows(rows: FmpEarningsItem[]): NormalizedEarningsRow[] {
  return rows.map((row) => ({
    symbol: normalizeTickerSymbol(row.symbol),
    date: row.date,
    period: row.period,
    epsActual: row.epsActual,
    epsEstimate: row.epsEstimate,
    surprisePercent: row.surprisePercent,
    revenueActual: row.revenueActual,
    revenueEstimate: row.revenueEstimate,
    source: "fmp"
  }));
}

function normalizeFinnhubRows(rows: FinnhubEarningsCalendarItem[]): NormalizedEarningsRow[] {
  return rows.map((row) => ({
    symbol: normalizeTickerSymbol(row.symbol),
    date: row.date,
    period: row.period,
    epsActual: row.epsActual,
    epsEstimate: row.epsEstimate,
    surprisePercent: row.surprisePercent,
    revenueActual: null,
    revenueEstimate: row.revenueEstimate,
    source: "finnhub"
  }));
}

function filterSp500DatedRows(rows: NormalizedEarningsRow[], sp500Symbols: Set<string>): NormalizedEarningsRow[] {
  return rows.filter((row) => row.symbol && row.date && sp500Symbols.has(row.symbol));
}

function pickLatestCompletePassedRows(pastPool: NormalizedEarningsRow[], maxRows: number): NormalizedEarningsRow[] {
  const latestCompleteBySymbol = new Map<string, NormalizedEarningsRow>();
  for (const row of pastPool) {
    if (!hasPassedInfo(row)) continue;
    const current = latestCompleteBySymbol.get(row.symbol);
    if (!current || (row.date ?? "") > (current.date ?? "")) {
      latestCompleteBySymbol.set(row.symbol, row);
    }
  }
  return nearestUniqueBySymbol(sortPassed(uniqueEarningsRows(Array.from(latestCompleteBySymbol.values()))), maxRows);
}

export async function getEarningsPayload(): Promise<EarningsServiceResult> {
  try {
    if (earningsCache && Date.now() < earningsCache.expiresAt) {
      return {
        ok: true,
        status: 200,
        payload: earningsCache.payload,
        cacheControl: EARNINGS_CACHE_HEADER
      };
    }

    const today = new Date();
    const from = toIsoDateString(today);
    const to = toIsoDateString(new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000));
    const pastFrom = toIsoDateString(new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000));
    const todayEpoch = toDayEpoch(from) ?? 0;

    const [sp500DirectoryResult, fmpUpcomingResult, fmpPastResult, finnhubUpcomingResult, finnhubPastResult] =
      await Promise.allSettled([
        fetchSP500Directory(),
        fetchFmpEarningsCalendar(from, to),
        fetchFmpEarningsCalendar(pastFrom, from),
        fetchFinnhubEarningsCalendar(from, to),
        fetchFinnhubEarningsCalendar(pastFrom, from)
      ]);

    const sp500Directory = sp500DirectoryResult.status === "fulfilled" ? sp500DirectoryResult.value : {};
    const fmpUpcomingRaw = fmpUpcomingResult.status === "fulfilled" ? fmpUpcomingResult.value : [];
    const fmpPastRaw = fmpPastResult.status === "fulfilled" ? fmpPastResult.value : [];
    const finnhubUpcomingRaw = finnhubUpcomingResult.status === "fulfilled" ? finnhubUpcomingResult.value : [];
    const finnhubPastRaw = finnhubPastResult.status === "fulfilled" ? finnhubPastResult.value : [];

    const sp500Symbols = buildSp500SymbolUniverse(sp500Directory);
    const resolveName = (symbol: string): string =>
      normalizeCompanyName(sp500Directory[symbol]?.companyName) ??
      normalizeCompanyName(sp500Directory[symbol.replace(/\./g, "-")]?.companyName) ??
      symbol;

    const upcomingPool = sortUpcoming(
      uniqueEarningsRows([
        ...filterSp500DatedRows(normalizeFmpRows(fmpUpcomingRaw), sp500Symbols),
        ...filterSp500DatedRows(normalizeFinnhubRows(finnhubUpcomingRaw), sp500Symbols)
      ])
    ).filter((row) => {
      const epoch = toDayEpoch(row.date);
      return epoch !== null && epoch >= todayEpoch;
    });

    const upcomingCandidates = nearestUniqueBySymbol([...upcomingPool.filter((row) => hasUpcomingInfo(row)), ...upcomingPool], 3);
    let upcoming: EarningsUpcomingItem[] = upcomingCandidates.map((row) => ({
      symbol: row.symbol,
      companyName: resolveName(row.symbol),
      date: row.date,
      epsEstimate: row.epsEstimate
    }));
    if (upcoming.length < 3) {
      const existing = new Set(upcoming.map((row) => row.symbol));
      for (const symbol of FALLBACK_EARNINGS_SYMBOLS) {
        if (existing.has(symbol)) continue;
        upcoming.push({
          symbol,
          companyName: resolveName(symbol),
          date: null,
          epsEstimate: null
        });
        if (upcoming.length >= 3) break;
      }
    }

    const pastPool = sortPassed(
      uniqueEarningsRows([
        ...filterSp500DatedRows(normalizeFmpRows(fmpPastRaw), sp500Symbols),
        ...filterSp500DatedRows(normalizeFinnhubRows(finnhubPastRaw), sp500Symbols)
      ])
    ).filter((row) => {
      const epoch = toDayEpoch(row.date);
      return epoch !== null && epoch <= todayEpoch;
    });

    const completePassedRows = pickLatestCompletePassedRows(pastPool, 3);
    const passedCandidates = nearestUniqueBySymbol([...completePassedRows, ...pastPool], 3);

    let passed: EarningsPassedItem[] = passedCandidates.map((row) => ({
      symbol: row.symbol,
      companyName: resolveName(row.symbol),
      date: row.date,
      period: row.period ?? row.date,
      actual: row.epsActual,
      estimate: row.epsEstimate,
      surprisePercent: row.surprisePercent,
      outcome: outcomeFromSurprise(row.surprisePercent, row.epsActual, row.epsEstimate)
    }));
    if (passed.length < 3) {
      const existing = new Set(passed.map((row) => row.symbol));
      for (const symbol of FALLBACK_EARNINGS_SYMBOLS) {
        if (existing.has(symbol)) continue;
        passed.push({
          symbol,
          companyName: resolveName(symbol),
          date: null,
          period: null,
          actual: null,
          estimate: null,
          surprisePercent: null,
          outcome: "unknown"
        });
        if (passed.length >= 3) break;
      }
    }

    const payload: EarningsPayload = {
      upcoming: upcoming.slice(0, 3),
      passed: passed.slice(0, 3)
    };

    earningsCache = {
      expiresAt: Date.now() + EARNINGS_CACHE_TTL_MS,
      payload
    };

    await publishEarnings({ upcoming: payload.upcoming });

    return {
      ok: true,
      status: 200,
      payload,
      cacheControl: EARNINGS_CACHE_HEADER
    };
  } catch (error) {
    log({
      level: "error",
      service: "earnings-service",
      message: "Failed to build earnings payload",
      error: error instanceof Error ? error.message : String(error)
    });
    if (earningsCache?.payload) {
      return {
        ok: true,
        status: 200,
        payload: earningsCache.payload,
        cacheControl: EARNINGS_CACHE_HEADER
      };
    }

    return {
      ok: false,
      status: 500,
      error: "Failed to load earnings.",
      cacheControl: "no-store"
    };
  }
}
