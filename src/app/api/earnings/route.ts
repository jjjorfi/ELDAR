import { NextResponse } from "next/server";

import { fetchFmpEarningsCalendar, type FmpEarningsItem } from "@/lib/market/fmp";
import { fetchFinnhubEarningsCalendar, type FinnhubEarningsCalendarItem } from "@/lib/market/finnhub";
import { fetchSP500Directory } from "@/lib/market/sp500";
import { getTop100Sp500SymbolSet } from "@/lib/market/top100";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const EARNINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_HEADER = "public, max-age=1800, s-maxage=21600, stale-while-revalidate=43200";
const FALLBACK_EARNINGS_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "UNH"];

let earningsCache:
  | {
      expiresAt: number;
      payload: {
        upcoming: EarningsUpcomingItem[];
        passed: EarningsPassedItem[];
      };
    }
  | null = null;

interface EarningsUpcomingItem {
  symbol: string;
  companyName: string;
  date: string | null;
  epsEstimate: number | null;
}

interface EarningsPassedItem {
  symbol: string;
  companyName: string;
  date: string | null;
  period: string | null;
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
  outcome: "beat" | "miss" | "inline" | "unknown";
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

/**
 * Normalizes ticker symbols across providers (e.g. BRK-B -> BRK.B).
 *
 * @param symbol Input symbol.
 * @returns Uppercase normalized symbol.
 */
function normalizeTickerSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/-/g, ".");
}

/**
 * Formats a Date into YYYY-MM-DD.
 *
 * @param date Input date.
 * @returns ISO day string.
 */
function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Converts a day string into UTC epoch ms.
 *
 * @param dateValue Date string.
 * @returns UTC epoch milliseconds or null.
 */
function toDayEpoch(dateValue: string | null): number | null {
  if (!dateValue) return null;
  const epoch = Date.parse(`${dateValue}T00:00:00Z`);
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * Classifies earnings outcome using surprise or derived values.
 *
 * @param surprisePercent Surprise percentage.
 * @param actual Actual EPS.
 * @param estimate Estimated EPS.
 * @returns Outcome label.
 */
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

/**
 * Checks whether row has complete upcoming earnings info for UI.
 *
 * @param row Earnings row candidate.
 * @returns True when date and EPS estimate are present.
 */
function hasUpcomingInfo(row: NormalizedEarningsRow): boolean {
  return row.date !== null && row.epsEstimate !== null;
}

/**
 * Checks whether row has complete passed earnings info for UI.
 *
 * @param row Earnings row candidate.
 * @returns True when date, actual EPS, and estimate EPS are present.
 */
function hasPassedInfo(row: NormalizedEarningsRow): boolean {
  return row.date !== null && row.epsActual !== null && row.epsEstimate !== null;
}

/**
 * Returns first rows with unique symbols, preserving order.
 *
 * @param rows Ordered input rows.
 * @param maxRows Maximum number of rows.
 * @returns Unique-symbol rows.
 */
function nearestUniqueBySymbol<T extends { symbol: string }>(rows: T[], maxRows: number): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const row of rows) {
    if (seen.has(row.symbol)) {
      continue;
    }
    seen.add(row.symbol);
    selected.push(row);
    if (selected.length >= maxRows) {
      break;
    }
  }
  return selected;
}

/**
 * Sorts upcoming rows by nearest future date, then symbol.
 *
 * @param rows Input rows.
 * @returns Sorted rows.
 */
function sortUpcoming(rows: NormalizedEarningsRow[]): NormalizedEarningsRow[] {
  return [...rows].sort((left, right) => {
    const byDate = (left.date ?? "").localeCompare(right.date ?? "");
    if (byDate !== 0) return byDate;
    return left.symbol.localeCompare(right.symbol);
  });
}

/**
 * Sorts passed rows by most recent date first, then symbol.
 *
 * @param rows Input rows.
 * @returns Sorted rows.
 */
function sortPassed(rows: NormalizedEarningsRow[]): NormalizedEarningsRow[] {
  return [...rows].sort((left, right) => {
    const byDate = (right.date ?? "").localeCompare(left.date ?? "");
    if (byDate !== 0) return byDate;
    return left.symbol.localeCompare(right.symbol);
  });
}

/**
 * Normalizes human-readable company names.
 *
 * @param name Raw name.
 * @returns Trimmed name or null.
 */
function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Removes duplicate earnings rows by symbol/date/period, preserving first occurrence.
 *
 * @param rows Input rows.
 * @returns Deduplicated rows.
 */
function uniqueEarningsRows(rows: NormalizedEarningsRow[]): NormalizedEarningsRow[] {
  const seen = new Set<string>();
  const out: NormalizedEarningsRow[] = [];

  for (const row of rows) {
    const key = `${row.symbol}|${row.date ?? ""}|${row.period ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }

  return out;
}

/**
 * Converts FMP earnings rows into normalized internal rows.
 *
 * @param rows FMP rows.
 * @returns Normalized rows.
 */
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

/**
 * Converts Finnhub earnings rows into normalized internal rows.
 *
 * @param rows Finnhub rows.
 * @returns Normalized rows.
 */
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

/**
 * Filters to S&P 500 members and valid dated rows.
 *
 * @param rows Input rows.
 * @param sp500Symbols S&P 500 symbol set.
 * @returns Filtered rows.
 */
function filterSp500DatedRows(rows: NormalizedEarningsRow[], sp500Symbols: Set<string>): NormalizedEarningsRow[] {
  return rows.filter((row) => row.symbol && row.date && sp500Symbols.has(row.symbol));
}

/**
 * Picks latest passed earnings rows with complete info, rotating symbols when data is missing.
 *
 * @param pastPool Ordered past rows from all providers.
 * @param maxRows Desired output row count.
 * @returns Complete rows sorted by latest date.
 */
function pickLatestCompletePassedRows(
  pastPool: NormalizedEarningsRow[],
  maxRows: number
): NormalizedEarningsRow[] {
  const latestCompleteBySymbol = new Map<string, NormalizedEarningsRow>();
  for (const row of pastPool) {
    if (!hasPassedInfo(row)) {
      continue;
    }
    const current = latestCompleteBySymbol.get(row.symbol);
    if (!current || (row.date ?? "") > (current.date ?? "")) {
      latestCompleteBySymbol.set(row.symbol, row);
    }
  }
  return nearestUniqueBySymbol(sortPassed(uniqueEarningsRows(Array.from(latestCompleteBySymbol.values()))), maxRows);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const throttled = enforceRateLimit(request, {
      bucket: "api-earnings",
      max: 90,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    if (earningsCache && Date.now() < earningsCache.expiresAt) {
      return NextResponse.json(earningsCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
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

    const top100Symbols = Array.from(getTop100Sp500SymbolSet()).map((symbol) => normalizeTickerSymbol(symbol));
    const sp500Symbols = new Set(top100Symbols);
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

    const upcomingCandidates = nearestUniqueBySymbol(
      [...upcomingPool.filter((row) => hasUpcomingInfo(row)), ...upcomingPool],
      3
    );
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

    const payload = {
      upcoming: upcoming.slice(0, 3),
      passed: passed.slice(0, 3)
    };
    earningsCache = {
      expiresAt: Date.now() + EARNINGS_CACHE_TTL_MS,
      payload
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": CACHE_HEADER } });
  } catch (error) {
    console.error("/api/earnings GET error", error);
    if (earningsCache?.payload) {
      return NextResponse.json(earningsCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }
    return NextResponse.json({ error: "Failed to load earnings." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
