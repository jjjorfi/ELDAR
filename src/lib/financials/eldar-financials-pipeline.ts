// File Purpose:
// - Canonical financial data pipeline for ELDAR.
// - Fetches SEC EDGAR + ranked market-data fallbacks, computes normalized quarterly/TTM metrics,
//   validates output, and persists cache rows in Neon Postgres.
//
// Integration Points:
// - /Users/s.bahij/Documents/ELDAR SaaS/src/lib/financials/eldar-financials-adapter.ts
// - /Users/s.bahij/Documents/ELDAR SaaS/src/lib/financials/eldar-financials-schema.ts
//
// Gotchas:
// - SEC companyfacts rows are used at their declared unit scale (USD, shares, etc.).
//   Do not blindly multiply by 1000; unit scaling is resolved per selected unit.
// - The pipeline remains engine-agnostic. Engine mapping belongs in adapter only.

import { promises as fs } from "node:fs";
import path from "node:path";

import { sql } from "@vercel/postgres";

import { env } from "@/lib/env";
import { sicToGics, XBRL_TAGS } from "@/lib/financials/eldar-financials-taxonomy";
import type {
  CompanyFinancials,
  CompanyProfile,
  FinancialsQuality,
  GrowthMetrics,
  PriceHistory,
  PricePoint,
  PriceSource,
  QuarterlyBalanceSheet,
  QuarterlyCashFlow,
  QuarterlyIncome,
  QuarterlyRatios,
  TTMMetrics
} from "@/lib/financials/eldar-financials-types";
import { getFetchSignal, parseOptionalNumber, readEnvToken } from "@/lib/market/adapter-utils";
import { fetchTemporaryHistoryFallback, fetchTemporaryQuoteFallback } from "@/lib/market/orchestration/temporary-fallbacks";
import { sanitizeSymbol } from "@/lib/utils";

export const PIPELINE_VERSION = "eldar-financials-v1.1";
export { sicToGics, XBRL_TAGS } from "@/lib/financials/eldar-financials-taxonomy";
export type {
  CompanyFinancials,
  CompanyProfile,
  FinancialsQuality,
  GrowthMetrics,
  PriceHistory,
  PricePoint,
  QuarterlyBalanceSheet,
  QuarterlyCashFlow,
  QuarterlyIncome,
  QuarterlyRatios,
  TTMMetrics
} from "@/lib/financials/eldar-financials-types";

function readPositiveIntEnv(key: string, fallback: number, min = 1, max = 60_000): number {
  const raw = readEnvToken(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_TICKERS_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts";
const SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const SEC_BASE_INTERVAL_MS = readPositiveIntEnv("SEC_BASE_INTERVAL_MS", 170, 100, 2_000);
const SEC_MAX_INTERVAL_MS = readPositiveIntEnv("SEC_MAX_INTERVAL_MS", 2_000, SEC_BASE_INTERVAL_MS, 20_000);
const SEC_COOLDOWN_FLOOR_MS = readPositiveIntEnv("SEC_COOLDOWN_FLOOR_MS", 1_500, 250, 60_000);
const SEC_JITTER_MS = readPositiveIntEnv("SEC_JITTER_MS", 30, 0, 500);
const SEC_TIMEOUT_MS = 8_000;
const PRICE_FETCH_TIMEOUT_MS = 8_000;
const PRICE_HISTORY_MIN_POINTS = 273;
const PRICE_HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const PRICE_QUOTE_CACHE_TTL_MS = 8_000;
const FUNDAMENTALS_MAX_STALE_MS = 90 * 24 * 60 * 60 * 1000;
const PRICES_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUARTERS_BACK = 12;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 8;
const BULK_SOFT_SPACING_MS = readPositiveIntEnv("FINANCIALS_BULK_SPACING_MS", 25, 0, 500);
const LOCAL_FINANCIALS_CACHE_DIR = path.join(process.cwd(), ".cache", "financials");

// SEC ticker map files can be temporarily incomplete during list updates.
// Keep explicit overrides for known misses so core pipeline calls remain deterministic.
const SEC_CIK_OVERRIDES: Record<string, string> = {
  BXP: "0001037540"
};

let secTickerMapPromise: Promise<Map<string, string>> | null = null;
let secRateLimitQueue: Promise<void> = Promise.resolve();
let secAdaptiveIntervalMs = SEC_BASE_INTERVAL_MS;
let secNextAllowedAtMs = 0;
let secGlobalCooldownUntilMs = 0;
let tablesEnsured = false;
const buildInFlight = new Map<string, Promise<CompanyFinancials>>();

export class PipelineExcludedError extends Error {
  readonly ticker: string;
  readonly sector: string;

  constructor(ticker: string, sector: string, message?: string) {
    super(message ?? `Ticker ${ticker} in sector "${sector}" is excluded from this engine.`);
    this.name = "PipelineExcludedError";
    this.ticker = ticker;
    this.sector = sector;
  }
}

class SecUnavailableError extends Error {
  readonly status: number | null;
  readonly url: string;

  constructor(message: string, status: number | null, url: string) {
    super(message);
    this.name = "SecUnavailableError";
    this.status = status;
    this.url = url;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE SURFACES (see eldar-financials-types.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface BuildOptions {
  forceRefresh?: boolean;
  quartersBack?: number;
}

interface CacheEnvelope {
  payload: CompanyFinancials;
  fundamentalsRefreshedAtMs: number;
  pricesRefreshedAtMs: number;
  isFundamentalsFresh: boolean;
  isPricesFresh: boolean;
}

interface LocalFinancialsCacheEntry {
  payload: CompanyFinancials;
  pipelineVersion: string;
  fundamentalsRefreshedAt: string;
  pricesRefreshedAt: string;
  updatedAt: string;
}

interface EdgarTickerRow {
  ticker?: string;
  cik_str?: number;
}

interface EdgarTickerExchangePayload {
  fields?: string[];
  data?: Array<Array<string | number | null>>;
}

interface EdgarSubmissionsResponse {
  cik?: string;
  sic?: string;
  sicDescription?: string;
  name?: string;
  tickers?: string[];
  exchanges?: string[];
  fiscalYearEnd?: string;
  description?: string;
  formerNames?: Array<{ name?: string }>;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      periodOfReport?: string[];
    };
  };
}

interface EdgarFactRow {
  start?: string;
  end?: string;
  val?: number;
  form?: string;
  fp?: string;
  filed?: string;
  fy?: number;
  frame?: string;
}

interface EdgarCompanyFactsResponse {
  cik?: string;
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, EdgarFactRow[]> }>;
    dei?: Record<string, { units?: Record<string, EdgarFactRow[]> }>;
  };
}

interface ProviderPriceRow {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  adjClose?: number;
  volume?: number;
}

interface ProviderQuoteRow {
  source?: string;
  ticker?: string;
  last?: number;
  timestamp?: string;
}

interface RankedDailyPriceResult {
  rows: ProviderPriceRow[];
  source: PriceSource;
  warning: string | null;
}

interface YahooChartPayload {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{
          adjclose?: Array<number | null>;
        }>;
      };
    }>;
  };
}

interface FactPick {
  value: number | null;
  restated: boolean;
  tag?: string;
  unit?: string;
  form?: string;
  filed?: string;
}

interface FiscalPeriodMeta {
  periodEnd: string;
  formType: "10-Q" | "10-K";
  filedDate: string;
}

const rankedDailyPriceCache = new Map<string, { expiresAt: number; value: RankedDailyPriceResult }>();
const rankedDailyPriceInFlight = new Map<string, Promise<RankedDailyPriceResult>>();
const rankedQuoteCache = new Map<string, { expiresAt: number; value: ProviderQuoteRow | null }>();
const rankedQuoteInFlight = new Map<string, Promise<ProviderQuoteRow | null>>();

type XbrlConcept = keyof typeof XBRL_TAGS;
type XbrlTagMap = { [K in XbrlConcept]: readonly string[] };

// Per-ticker alias layer for custom company extensions.
// This starts intentionally small and should grow from observed misses.
const TICKER_TAG_OVERRIDES: Partial<Record<string, Partial<Record<XbrlConcept, readonly string[]>>>> = {
  // APA currently reports sparse us-gaap revenue coverage in SEC companyfacts.
  // This temporary bridge keeps the parser alive with explicit fallback tags
  // until premium fundamentals become the default source of truth.
  APA: {
    revenue: ["BusinessAcquisitionsProFormaRevenue"]
  },
  // REITs frequently report lease-income tags instead of generic product/service revenue tags.
  EQR: {
    revenue: ["OperatingLeaseLeaseIncome"]
  },
  CPT: {
    revenue: ["OperatingLeaseLeaseIncome"]
  }
};

function buildTagMapForTicker(ticker: string): XbrlTagMap {
  const overrides = TICKER_TAG_OVERRIDES[ticker] ?? {};
  const merged = {} as XbrlTagMap;

  for (const concept of Object.keys(XBRL_TAGS) as XbrlConcept[]) {
    const baseTags = XBRL_TAGS[concept];
    const overrideTags = overrides[concept] ?? [];
    merged[concept] = Array.from(new Set([...overrideTags, ...baseTags]));
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC PIPELINE API
// ─────────────────────────────────────────────────────────────────────────────

export async function buildCompanyFinancials(ticker: string, options: BuildOptions = {}): Promise<CompanyFinancials> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    throw new Error("Invalid ticker.");
  }

  const inFlight = buildInFlight.get(normalizedTicker);
  if (inFlight) {
    return inFlight;
  }

  const run = internalBuildCompanyFinancials(normalizedTicker, options).finally(() => {
    buildInFlight.delete(normalizedTicker);
  });
  buildInFlight.set(normalizedTicker, run);
  return run;
}

export async function getCompanyFinancials(ticker: string): Promise<CompanyFinancials> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    throw new Error("Invalid ticker.");
  }

  const cacheEnvelope = await loadCacheEnvelope(normalizedTicker);
  if (cacheEnvelope) {
    if (cacheEnvelope.isFundamentalsFresh && cacheEnvelope.isPricesFresh) {
      return cacheEnvelope.payload;
    }

    if (cacheEnvelope.isFundamentalsFresh && !cacheEnvelope.isPricesFresh) {
      try {
        return await refreshPricesOnly(cacheEnvelope.payload);
      } catch (refreshError) {
        const stalePayload = cloneFinancials(cacheEnvelope.payload);
        stalePayload.warnings = Array.from(
          new Set([
            ...stalePayload.warnings,
            `Price refresh fallback used at ${new Date().toISOString()} due to refresh error: ${toErrorMessage(refreshError)}`
          ])
        );
        stalePayload.confidence = deriveConfidence(stalePayload.imputedFields, stalePayload.warnings);
        stalePayload.quality.stats.warningCount = stalePayload.warnings.length;
        return stalePayload;
      }
    }
  }

  try {
    return await buildCompanyFinancials(normalizedTicker, { forceRefresh: true });
  } catch (buildError) {
    if (cacheEnvelope && isSecUnavailableError(buildError)) {
      const stalePayload = cloneFinancials(cacheEnvelope.payload);
      stalePayload.warnings = Array.from(
        new Set([
          ...stalePayload.warnings,
          `Serving cached fundamentals due to SEC throttle/unavailability at ${new Date().toISOString()}: ${toErrorMessage(buildError)}`
        ])
      );
      stalePayload.confidence = deriveConfidence(stalePayload.imputedFields, stalePayload.warnings);
      stalePayload.quality.stats.warningCount = stalePayload.warnings.length;
      return stalePayload;
    }
    throw buildError;
  }
}

export async function getMultipleCompanyFinancials(
  tickers: string[],
  concurrency = DEFAULT_CONCURRENCY
): Promise<Map<string, CompanyFinancials>> {
  const normalized = Array.from(new Set(tickers.map((ticker) => normalizeTicker(ticker)).filter(Boolean)));
  const limit = Math.max(1, Math.min(MAX_CONCURRENCY, concurrency));
  const applySoftPacing = normalized.length >= 75 && BULK_SOFT_SPACING_MS > 0;
  const result = new Map<string, CompanyFinancials>();

  const queue = [...normalized];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const ticker = queue.shift();
      if (!ticker) continue;
      const financials = await getCompanyFinancials(ticker);
      result.set(ticker, financials);
      if (applySoftPacing) {
        await sleep(BULK_SOFT_SPACING_MS);
      }
    }
  });

  await Promise.all(workers);
  return result;
}

export async function refreshOnNewFiling(ticker: string): Promise<CompanyFinancials> {
  return buildCompanyFinancials(ticker, {
    forceRefresh: true,
    quartersBack: DEFAULT_QUARTERS_BACK
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL BUILD
// ─────────────────────────────────────────────────────────────────────────────

async function internalBuildCompanyFinancials(ticker: string, options: BuildOptions): Promise<CompanyFinancials> {
  const warnings: string[] = [];
  const imputedFields: string[] = [];
  const latestFieldSourceTrace: Record<string, string> = {};
  const quartersBack = Math.max(4, options.quartersBack ?? DEFAULT_QUARTERS_BACK);

  const cik = await resolveCikForTicker(ticker);
  if (!cik) {
    throw new Error(`CIK not found for ${ticker}.`);
  }

  const [submissions, facts] = await Promise.all([
    fetchSecSubmissions(cik),
    fetchSecCompanyFacts(cik)
  ]);

  const [tickerPriceResult, spyPriceResult, quote] = await Promise.all([
    fetchRankedDailyPrices(ticker),
    fetchRankedDailyPrices("SPY"),
    fetchRankedQuote(ticker)
  ]);
  const dailyPrices = tickerPriceResult.rows;
  const spyPrices = spyPriceResult.rows;
  const pricesSource = tickerPriceResult.source;

  if (tickerPriceResult.warning) warnings.push(tickerPriceResult.warning);
  if (spyPriceResult.warning) warnings.push(spyPriceResult.warning);
  if (quote?.source) {
    latestFieldSourceTrace.quote = quote.source;
  }

  const fiscalYearEnd = normalizeFiscalYearEnd(submissions.fiscalYearEnd);
  const sic = normalizeSic(submissions.sic);
  const sector = sicToGics(sic);
  const exchange = normalizeExchange(submissions.exchanges?.[0]) ?? "UNKNOWN";
  const description = trimOrNull(submissions.description) ?? "";
  const profile: CompanyProfile = {
    ticker,
    cik,
    name: trimOrNull(submissions.name) ?? ticker,
    exchange,
    sector,
    sic,
    currency: "USD",
    fiscalYearEnd,
    description,
    employees: null
  };

  const periodMeta = buildTargetPeriods(submissions, quartersBack);
  if (periodMeta.length < 4) {
    throw new Error(`Need 4+ quarters, got ${periodMeta.length}.`);
  }

  const factsGaap = facts.facts?.["us-gaap"] ?? {};
  const factsDei = facts.facts?.dei ?? {};
  const tags = buildTagMapForTicker(ticker);
  const monetaryUnits = ["USD"];
  const perShareUnits = ["USD/shares", "pure"];
  const shareUnits = ["shares"];

  const income: QuarterlyIncome[] = [];
  const balance: QuarterlyBalanceSheet[] = [];
  const cashflow: QuarterlyCashFlow[] = [];
  const restatedPeriods = new Set<string>();

  let hasRestatement = false;
  const latestPeriodEnd = periodMeta.at(-1)?.periodEnd ?? "";

  for (const period of periodMeta) {
    const periodEnd = period.periodEnd;
    const fiscalQuarter = deriveFiscalQuarter(periodEnd, fiscalYearEnd);
    const fiscalYear = deriveFiscalYear(periodEnd, fiscalYearEnd);

    const revenuePick = pickFact(factsGaap, tags.revenue, periodEnd, monetaryUnits, warnings);
    const revenue = revenuePick.value;
    if (revenue === null || revenue <= 0) {
      warnings.push(`Revenue missing at ${periodEnd}; quarter skipped.`);
      continue;
    }
    if (periodEnd === latestPeriodEnd) {
      recordFieldSource(latestFieldSourceTrace, "revenue", revenuePick);
    }

    const costOfRevenue = pickFact(factsGaap, tags.costOfRevenue, periodEnd, monetaryUnits, warnings).value;
    const grossProfitTagged = pickFact(factsGaap, tags.grossProfit, periodEnd, monetaryUnits, warnings).value;
    const grossProfit = grossProfitTagged ?? computeDifference(revenue, costOfRevenue);
    const grossMargin = safeDivide(grossProfit, revenue);

    const rAndD = pickFact(factsGaap, tags.researchDevelopment, periodEnd, monetaryUnits, warnings).value;
    const sga = pickFact(factsGaap, tags.sellingGeneralAdmin, periodEnd, monetaryUnits, warnings).value;
    const depreciationAmortization = pickFact(
      factsGaap,
      tags.depreciationAmortization,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const stockBasedCompensation = pickFact(
      factsGaap,
      tags.stockBasedCompensation,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;

    const interestExpense = pickFact(factsGaap, tags.interestExpense, periodEnd, monetaryUnits, warnings).value;
    const interestIncome = pickFact(factsGaap, tags.interestIncome, periodEnd, monetaryUnits, warnings).value;
    const netInterestExpense = subtractNullable(interestExpense, interestIncome);

    const incomeBeforeTax = pickFact(factsGaap, tags.incomeBeforeTax, periodEnd, monetaryUnits, warnings).value;
    const incomeTaxExpense = pickFact(factsGaap, tags.incomeTaxExpense, periodEnd, monetaryUnits, warnings).value;
    const netIncomePick = pickFact(factsGaap, tags.netIncome, periodEnd, monetaryUnits, warnings);
    const netIncome = netIncomePick.value;
    if (netIncome === null) {
      warnings.push(`Net income missing at ${periodEnd}; quarter skipped.`);
      continue;
    }

    const ebitPick = pickFact(factsGaap, tags.ebit, periodEnd, monetaryUnits, warnings);
    let ebit = ebitPick.value;
    let ebitDerived = false;
    if (ebit === null && incomeBeforeTax !== null) {
      const derivedEbit = incomeBeforeTax + (interestExpense ?? 0) - (interestIncome ?? 0);
      if (Number.isFinite(derivedEbit)) {
        ebit = derivedEbit;
        ebitDerived = true;
        imputedFields.push(`ebitDerived:${periodEnd}`);
        warnings.push(`EBIT derived from pre-tax + net interest at ${periodEnd}.`);
      }
    }
    if (ebit === null && incomeTaxExpense !== null) {
      const derivedFromNetIncome = netIncome + incomeTaxExpense + (netInterestExpense ?? 0);
      if (Number.isFinite(derivedFromNetIncome)) {
        ebit = derivedFromNetIncome;
        ebitDerived = true;
        imputedFields.push(`ebitDerivedFromNetIncome:${periodEnd}`);
        warnings.push(`EBIT derived from net income + tax + net interest at ${periodEnd}.`);
      }
    }
    if (ebit === null) {
      const derivedFromNetIncomeOnly = netIncome + (netInterestExpense ?? 0);
      if (Number.isFinite(derivedFromNetIncomeOnly)) {
        ebit = derivedFromNetIncomeOnly;
        ebitDerived = true;
        imputedFields.push(`ebitDerivedFromNetIncomeOnly:${periodEnd}`);
        warnings.push(`EBIT derived from net income (+ net interest) at ${periodEnd}.`);
      }
    }
    if (ebit === null) {
      warnings.push(`EBIT missing at ${periodEnd}; quarter skipped.`);
      continue;
    }
    if (periodEnd === latestPeriodEnd) {
      if (ebitPick.value !== null) {
        recordFieldSource(latestFieldSourceTrace, "ebit", ebitPick);
      } else if (ebitDerived) {
        latestFieldSourceTrace.ebit = "Derived from pre-tax/net income + tax + net interest";
      }
    }
    const ebitda = depreciationAmortization !== null ? ebit + depreciationAmortization : null;
    const ebitMargin = safeDivide(ebit, revenue);
    const ebitdaMargin = safeDivide(ebitda, revenue);
    if (periodEnd === latestPeriodEnd) {
      recordFieldSource(latestFieldSourceTrace, "netIncome", netIncomePick);
    }
    const netMargin = safeDivide(netIncome, revenue);

    const effectiveTaxRate = computeEffectiveTaxRate(incomeTaxExpense, incomeBeforeTax, imputedFields, periodEnd);

    const epsDiluted = pickFact(factsGaap, tags.epsDiluted, periodEnd, perShareUnits, warnings, false).value;
    const epsBasic = pickFact(factsGaap, tags.epsBasic, periodEnd, perShareUnits, warnings, false).value;
    const sharesDiluted = pickFact(factsGaap, tags.sharesDiluted, periodEnd, shareUnits, warnings, false).value;
    const sharesBasic = pickFact(factsGaap, tags.sharesBasic, periodEnd, shareUnits, warnings, false).value;
    const dividendsPerShare = pickFact(
      factsGaap,
      tags.dividendsPerShare,
      periodEnd,
      perShareUnits,
      warnings,
      false
    ).value;

    const incomeQuarter: QuarterlyIncome = {
      fiscalYear,
      fiscalQuarter,
      periodEnd,
      formType: period.formType,
      filedDate: period.filedDate,
      revenue,
      costOfRevenue,
      grossProfit,
      grossMargin,
      researchDevelopment: rAndD,
      sellingGeneralAdmin: sga,
      depreciationAmortization,
      stockBasedCompensation,
      ebit,
      ebitda,
      ebitMargin,
      ebitdaMargin,
      interestExpense,
      interestIncome,
      netInterestExpense,
      incomeBeforeTax,
      incomeTaxExpense,
      effectiveTaxRate,
      netIncome,
      netMargin,
      epsDiluted,
      epsBasic,
      sharesDiluted,
      sharesBasic,
      dividendsPerShare
    };
    income.push(incomeQuarter);

    const cashPick = pickFact(factsGaap, tags.cash, periodEnd, monetaryUnits, warnings);
    const assetsPick = pickFact(factsGaap, tags.totalAssets, periodEnd, monetaryUnits, warnings);
    const equityPick = pickFact(factsGaap, tags.stockholdersEquity, periodEnd, monetaryUnits, warnings);
    const cash = cashPick.value;
    const totalAssets = assetsPick.value;
    const stockholdersEquity = equityPick.value;
    if (cash === null || totalAssets === null || stockholdersEquity === null) {
      warnings.push(`Balance sheet critical fields missing at ${periodEnd}; quarter skipped.`);
      continue;
    }
    if (periodEnd === latestPeriodEnd) {
      recordFieldSource(latestFieldSourceTrace, "cash", cashPick);
      recordFieldSource(latestFieldSourceTrace, "totalAssets", assetsPick);
      recordFieldSource(latestFieldSourceTrace, "stockholdersEquity", equityPick);
    }

    const shortTermInvestments = pickFact(
      factsGaap,
      tags.shortTermInvestments,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const accountsReceivable = pickFact(
      factsGaap,
      tags.accountsReceivable,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const inventory = pickFact(factsGaap, tags.inventory, periodEnd, monetaryUnits, warnings).value;
    const totalCurrentAssets = pickFact(
      factsGaap,
      tags.totalCurrentAssets,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const ppAndENet = pickFact(factsGaap, tags.ppAndENet, periodEnd, monetaryUnits, warnings).value;
    const ppAndEGross = pickFact(factsGaap, tags.ppAndEGross, periodEnd, monetaryUnits, warnings).value;
    const goodwill = pickFact(factsGaap, tags.goodwill, periodEnd, monetaryUnits, warnings).value;
    const intangibleAssets = pickFact(factsGaap, tags.intangibleAssets, periodEnd, monetaryUnits, warnings).value;
    const accountsPayable = pickFact(factsGaap, tags.accountsPayable, periodEnd, monetaryUnits, warnings).value;
    const shortTermDebt = pickFact(factsGaap, tags.shortTermDebt, periodEnd, monetaryUnits, warnings).value;
    const currentPortionLTD = pickFact(
      factsGaap,
      tags.currentPortionLongTermDebt,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const deferredRevenueCurrent = pickFact(
      factsGaap,
      tags.deferredRevenueCurrent,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const totalCurrentLiabilities = pickFact(
      factsGaap,
      tags.totalCurrentLiabilities,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const longTermDebt = pickFact(factsGaap, tags.longTermDebt, periodEnd, monetaryUnits, warnings).value;
    const operatingLeaseLiability = pickFact(
      factsGaap,
      tags.operatingLeaseLiability,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const totalLiabilities = pickFact(factsGaap, tags.totalLiabilities, periodEnd, monetaryUnits, warnings).value;
    const retainedEarnings = pickFact(factsGaap, tags.retainedEarnings, periodEnd, monetaryUnits, warnings).value;
    const treasuryStock = pickFact(factsGaap, tags.treasuryStock, periodEnd, monetaryUnits, warnings).value;
    const sharesOutstanding = pickShareCountFact(factsGaap, tags.sharesOutstanding, periodEnd, warnings)
      ?? pickShareCountFact(factsDei, tags.sharesOutstanding, periodEnd, warnings);

    const totalCashAndInvestments = addNullable(cash, shortTermInvestments);
    const totalDebt = sumNullable([shortTermDebt, currentPortionLTD, longTermDebt, operatingLeaseLiability]);
    const netDebt = totalDebt !== null ? totalDebt - cash : null;
    const operatingCash = revenue * 0.02;
    const excessCash = Math.max(0, cash - operatingCash);
    const investedCapitalRaw = totalDebt !== null ? totalDebt + stockholdersEquity - excessCash : null;
    const investedCapital = investedCapitalRaw !== null ? Math.max(investedCapitalRaw, 1) : null;
    const tangibleBookValue = subtractMany(stockholdersEquity, [goodwill, intangibleAssets]);
    const bookValuePerShare = safeDivide(stockholdersEquity, sharesOutstanding);
    const tangibleBookValuePerShare = safeDivide(tangibleBookValue, sharesOutstanding);
    const workingCapital = subtractNullable(totalCurrentAssets, totalCurrentLiabilities);

    balance.push({
      fiscalYear,
      fiscalQuarter,
      periodEnd,
      cash,
      shortTermInvestments,
      totalCashAndInvestments,
      accountsReceivable,
      inventory,
      totalCurrentAssets,
      ppAndENet,
      ppAndEGross,
      goodwill,
      intangibleAssets,
      totalAssets,
      accountsPayable,
      shortTermDebt,
      currentPortionLTD,
      deferredRevenueCurrent,
      totalCurrentLiabilities,
      longTermDebt,
      operatingLeaseLiability,
      totalLiabilities,
      retainedEarnings,
      treasuryStock,
      stockholdersEquity,
      sharesOutstanding,
      totalDebt,
      netDebt,
      investedCapital,
      tangibleBookValue,
      bookValuePerShare,
      tangibleBookValuePerShare,
      workingCapital
    });

    const ocfPick = pickFact(factsGaap, tags.operatingCashFlow, periodEnd, monetaryUnits, warnings);
    const operatingCashFlow = ocfPick.value;
    if (operatingCashFlow === null) {
      warnings.push(`Operating cash flow missing at ${periodEnd}; quarter skipped.`);
      continue;
    }
    if (periodEnd === latestPeriodEnd) {
      recordFieldSource(latestFieldSourceTrace, "operatingCashFlow", ocfPick);
    }
    const capex = pickFact(factsGaap, tags.capex, periodEnd, monetaryUnits, warnings).value;
    const acquisitions = pickFact(factsGaap, tags.acquisitions, periodEnd, monetaryUnits, warnings).value;
    const purchasesOfInvestments = pickFact(
      factsGaap,
      tags.purchasesOfInvestments,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const salesOfInvestments = pickFact(
      factsGaap,
      tags.salesOfInvestments,
      periodEnd,
      monetaryUnits,
      warnings
    ).value;
    const investingCashFlow = pickFact(factsGaap, tags.investingCashFlow, periodEnd, monetaryUnits, warnings).value;
    const debtIssuance = pickFact(factsGaap, tags.debtIssuance, periodEnd, monetaryUnits, warnings).value;
    const debtRepayment = pickFact(factsGaap, tags.debtRepayment, periodEnd, monetaryUnits, warnings).value;
    const shareIssuance = pickFact(factsGaap, tags.shareIssuance, periodEnd, monetaryUnits, warnings).value;
    const shareBuybacks = pickFact(factsGaap, tags.shareBuybacks, periodEnd, monetaryUnits, warnings).value;
    const dividendsPaid = pickFact(factsGaap, tags.dividendsPaid, periodEnd, monetaryUnits, warnings).value;
    const financingCashFlow = pickFact(factsGaap, tags.financingCashFlow, periodEnd, monetaryUnits, warnings).value;
    const freeCashFlow = capex !== null ? operatingCashFlow - Math.abs(capex) : null;
    if (capex === null) {
      imputedFields.push(`freeCashFlow:${periodEnd}`);
    }
    const fcfMargin = safeDivide(freeCashFlow, revenue);
    const fcfConversion = safeDivide(freeCashFlow, netIncome);

    cashflow.push({
      fiscalYear,
      fiscalQuarter,
      periodEnd,
      operatingCashFlow,
      depreciationAmortization,
      stockBasedCompensation,
      capex,
      acquisitions,
      purchasesOfInvestments,
      salesOfInvestments,
      investingCashFlow,
      debtIssuance,
      debtRepayment,
      shareIssuance,
      shareBuybacks,
      dividendsPaid,
      financingCashFlow,
      freeCashFlow,
      fcfMargin,
      fcfConversion
    });

    if (revenuePick.restated || ebitPick.restated || netIncomePick.restated) {
      hasRestatement = true;
      restatedPeriods.add(periodEnd);
    }
  }

  if (income.length < 2 || balance.length < 2 || cashflow.length < 2) {
    throw new Error(`Need 2+ aligned quarters. income=${income.length} balance=${balance.length} cashflow=${cashflow.length}`);
  }
  if (income.length < 4 || balance.length < 4 || cashflow.length < 4) {
    warnings.push(
      `Partial history: income=${income.length}, balance=${balance.length}, cashflow=${cashflow.length}. Ratios/confidence reduced until 4+ quarters are available.`
    );
  }

  const normalizedFlows = normalizeAnnualQ4Flows(income, cashflow, warnings);

  // Keep only common periods across all three statements to maintain strict alignment.
  const commonPeriodEnds = intersectPeriods(
    normalizedFlows.income.map((row) => row.periodEnd),
    balance.map((row) => row.periodEnd),
    normalizedFlows.cashflow.map((row) => row.periodEnd)
  );
  const alignedIncome = normalizedFlows.income.filter((row) => commonPeriodEnds.has(row.periodEnd));
  const alignedBalance = balance.filter((row) => commonPeriodEnds.has(row.periodEnd));
  const alignedCashflow = normalizedFlows.cashflow.filter((row) => commonPeriodEnds.has(row.periodEnd));

  if (alignedIncome.length < 2) {
    throw new Error("Fewer than 2 aligned quarters after normalization.");
  }
  if (alignedIncome.length < 4) {
    warnings.push("Fewer than 4 aligned quarters after normalization; TTM and YoY metrics are partial.");
  }

  const latestAlignedPeriodEnd = alignedIncome.at(-1)?.periodEnd ?? null;
  if (latestAlignedPeriodEnd) {
    backfillLatestFieldSourceTrace(latestFieldSourceTrace, latestAlignedPeriodEnd, factsGaap, tags, monetaryUnits);
  }

  const sortedPrices = normalizeProviderPrices(dailyPrices);
  const sortedSpyPrices = normalizeProviderPrices(spyPrices);
  if (sortedPrices.length < 252) {
    throw new Error(`Daily price history is insufficient for ${ticker}.`);
  }

  const ratios = computeQuarterlyRatios(alignedIncome, alignedBalance, alignedCashflow, sortedPrices, warnings);
  const ttm = computeTTM(alignedIncome, alignedCashflow, alignedBalance);
  const growth = computeGrowth(alignedIncome, alignedCashflow);
  const prices = computePriceHistory(sortedPrices, sortedSpyPrices);
  latestFieldSourceTrace.price =
    pricesSource === "YAHOO_FALLBACK" ? "YAHOO chart adjusted close (temporary)" : `${pricesSource} daily close`;

  const dedupedImputedFields = Array.from(new Set(imputedFields));
  const dedupedWarnings = Array.from(new Set(warnings));
  const confidence = deriveConfidence(dedupedImputedFields, dedupedWarnings);

  const financials: CompanyFinancials = {
    ticker,
    cik,
    asOf: new Date().toISOString(),
    pipelineVersion: PIPELINE_VERSION,
    profile,
    income: alignedIncome,
    balance: alignedBalance,
    cashflow: alignedCashflow,
    ratios,
    ttm,
    growth,
    prices: {
      ...prices,
      daily: prices.daily
    },
    quality: {
      fundamentalsSource: "SEC_EDGAR",
      pricesSource,
      latestFieldSourceTrace,
      restatedPeriods: Array.from(restatedPeriods).sort(),
      stats: {
        quartersParsed: income.length,
        quartersAligned: alignedIncome.length,
        imputedFieldCount: dedupedImputedFields.length,
        warningCount: dedupedWarnings.length
      }
    },
    confidence,
    imputedFields: dedupedImputedFields,
    warnings: dedupedWarnings
  };

  validateFinancials(financials);
  applyAnomalyWarnings(financials);
  financials.warnings = Array.from(new Set(financials.warnings));
  financials.confidence = deriveConfidence(financials.imputedFields, financials.warnings);
  financials.quality.stats.warningCount = financials.warnings.length;
  await saveToCache(financials, hasRestatement, quote);
  return financials;
}

async function refreshPricesOnly(cached: CompanyFinancials): Promise<CompanyFinancials> {
  const ticker = normalizeTicker(cached.ticker);
  if (!ticker) {
    throw new Error("Invalid ticker in cached financials payload.");
  }

  const warnings = [...cached.warnings];
  const latestFieldSourceTrace = { ...cached.quality.latestFieldSourceTrace };

  const [tickerPriceResult, spyPriceResult, quote] = await Promise.all([
    fetchRankedDailyPrices(ticker),
    fetchRankedDailyPrices("SPY"),
    fetchRankedQuote(ticker)
  ]);

  if (tickerPriceResult.warning) warnings.push(tickerPriceResult.warning);
  if (spyPriceResult.warning) warnings.push(spyPriceResult.warning);
  if (quote?.source) latestFieldSourceTrace.quote = quote.source;

  const sortedPrices = normalizeProviderPrices(tickerPriceResult.rows);
  const sortedSpyPrices = normalizeProviderPrices(spyPriceResult.rows);
  if (sortedPrices.length < 252) {
    throw new Error(`Daily price history is insufficient for ${ticker}.`);
  }

  const refreshed = cloneFinancials(cached);
  refreshed.asOf = new Date().toISOString();
  refreshed.ratios = computeQuarterlyRatios(refreshed.income, refreshed.balance, refreshed.cashflow, sortedPrices, warnings);
  refreshed.prices = computePriceHistory(sortedPrices, sortedSpyPrices);
  refreshed.quality.pricesSource = tickerPriceResult.source;
  refreshed.quality.latestFieldSourceTrace = {
    ...latestFieldSourceTrace,
    price:
      tickerPriceResult.source === "YAHOO_FALLBACK"
        ? "YAHOO chart adjusted close (temporary)"
        : `${tickerPriceResult.source} daily close`
  };
  refreshed.warnings = Array.from(new Set(warnings));
  refreshed.confidence = deriveConfidence(refreshed.imputedFields, refreshed.warnings);
  refreshed.quality.stats.warningCount = refreshed.warnings.length;

  validateFinancials(refreshed);
  await saveToCache(refreshed, refreshed.quality.restatedPeriods.length > 0, quote);
  return refreshed;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE COMPUTATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeTicker(value: string): string {
  return sanitizeSymbol(value).replace(/\./g, "-");
}

function cloneFinancials(financials: CompanyFinancials): CompanyFinancials {
  return JSON.parse(JSON.stringify(financials)) as CompanyFinancials;
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeExchange(value: unknown): string | null {
  const raw = trimOrNull(value);
  if (!raw) return null;
  return raw.toUpperCase();
}

function normalizeSic(value: unknown): string {
  const raw = trimOrNull(value);
  if (!raw) return "";
  return raw.replace(/[^\d]/g, "");
}

function normalizeFiscalYearEnd(value: unknown): string {
  const raw = trimOrNull(value);
  if (!raw) return "12-31";
  const numeric = raw.replace(/[^\d]/g, "");
  if (numeric.length !== 4) return "12-31";
  return `${numeric.slice(0, 2)}-${numeric.slice(2, 4)}`;
}

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function computeDifference(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return left - right;
}

function subtractNullable(left: number | null, right: number | null): number | null {
  if (left === null) return null;
  if (right === null) return left;
  return left - right;
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.every((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function subtractMany(base: number | null, removals: Array<number | null>): number | null {
  if (base === null) return null;
  let running = base;
  for (const value of removals) {
    if (value !== null) {
      running -= value;
    }
  }
  return running;
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneProviderPriceRows(rows: ProviderPriceRow[]): ProviderPriceRow[] {
  return rows.map((row) => ({ ...row }));
}

function cloneRankedDailyPriceResult(value: RankedDailyPriceResult): RankedDailyPriceResult {
  return {
    rows: cloneProviderPriceRows(value.rows),
    source: value.source,
    warning: value.warning
  };
}

function normalizePriceCacheKey(ticker: string): string {
  return normalizeTicker(ticker).toUpperCase();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isSecUnavailableError(error: unknown): boolean {
  if (error instanceof SecUnavailableError) return true;
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("sec request failed")
    || message.includes("(429)")
    || message.includes("too many requests")
    || message.includes("temporarily unavailable")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function retryAsync<T>(operation: () => Promise<T>, attempts = 3, baseDelayMs = 200): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(baseDelayMs * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Retry operation failed.");
}

function computeEffectiveTaxRate(
  incomeTaxExpense: number | null,
  incomeBeforeTax: number | null,
  imputedFields: string[],
  periodEnd: string
): number {
  if (incomeTaxExpense !== null && incomeBeforeTax !== null && incomeBeforeTax > 0) {
    const rate = incomeTaxExpense / incomeBeforeTax;
    if (rate >= 0 && rate <= 0.5) {
      return rate;
    }
  }
  imputedFields.push(`effectiveTaxRate:${periodEnd}`);
  return 0.21;
}

function deriveFiscalQuarter(periodEnd: string, fiscalYearEnd: string): 1 | 2 | 3 | 4 {
  const periodMonth = Number.parseInt(periodEnd.slice(5, 7), 10);
  const fyEndMonth = Number.parseInt(fiscalYearEnd.slice(0, 2), 10);
  const monthsBack = (fyEndMonth - periodMonth + 12) % 12;
  if (monthsBack === 0) return 4;
  if (monthsBack <= 3) return 3;
  if (monthsBack <= 6) return 2;
  return 1;
}

function deriveFiscalYear(periodEnd: string, fiscalYearEnd: string): number {
  const periodYear = Number.parseInt(periodEnd.slice(0, 4), 10);
  const periodMonth = Number.parseInt(periodEnd.slice(5, 7), 10);
  const fyEndMonth = Number.parseInt(fiscalYearEnd.slice(0, 2), 10);
  if (!Number.isFinite(periodYear) || !Number.isFinite(periodMonth) || !Number.isFinite(fyEndMonth)) {
    return periodYear;
  }
  if (periodMonth > fyEndMonth) return periodYear + 1;
  return periodYear;
}

function intersectPeriods(...lists: string[][]): Set<string> {
  if (lists.length === 0) return new Set<string>();
  const [first, ...rest] = lists;
  const out = new Set(first);
  for (const list of rest) {
    const local = new Set(list);
    for (const item of out) {
      if (!local.has(item)) {
        out.delete(item);
      }
    }
  }
  return out;
}

function normalizeProviderPrices(rows: ProviderPriceRow[]): PricePoint[] {
  const clean: PricePoint[] = rows
    .map((row) => {
      const date = trimOrNull(row.date)?.slice(0, 10);
      const open = parseOptionalNumber(row.open);
      const high = parseOptionalNumber(row.high);
      const low = parseOptionalNumber(row.low);
      const close = parseOptionalNumber(row.close);
      const adjClose = parseOptionalNumber(row.adjClose) ?? close;
      const volume = parseOptionalNumber(row.volume);
      if (!date || open === null || high === null || low === null || close === null || adjClose === null || volume === null) {
        return null;
      }
      return {
        date,
        open,
        high,
        low,
        close,
        adjClose,
        volume
      };
    })
    .filter((row): row is PricePoint => row !== null)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));

  const deduped = new Map<string, PricePoint>();
  for (const row of clean) {
    deduped.set(row.date, row);
  }
  return [...deduped.values()].sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

function findPeriodEndAdjClose(prices: PricePoint[], periodEnd: string): number | null {
  const periodMs = parseDate(periodEnd);
  if (!Number.isFinite(periodMs) || periodMs <= 0) return null;
  let best: PricePoint | null = null;
  for (const row of prices) {
    const rowMs = parseDate(row.date);
    if (!Number.isFinite(rowMs) || rowMs > periodMs) continue;
    if (!best || rowMs > parseDate(best.date)) {
      best = row;
    }
  }
  return best?.adjClose ?? null;
}

function rolling4(values: Array<number | null>, index: number): number | null {
  if (index < 3) return null;
  const slice = values.slice(index - 3, index + 1);
  if (slice.some((value) => value === null)) return null;
  return slice.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function computeQuarterlyRatios(
  income: QuarterlyIncome[],
  balance: QuarterlyBalanceSheet[],
  cashflow: QuarterlyCashFlow[],
  prices: PricePoint[],
  warnings: string[]
): QuarterlyRatios[] {
  const rows: QuarterlyRatios[] = [];
  const revenueSeries = income.map((row) => row.revenue);
  const ebitSeries = income.map((row) => row.ebit);
  const ebitdaSeries = income.map((row) => row.ebitda);
  const netIncomeSeries = income.map((row) => row.netIncome);
  const epsSeries = income.map((row) => row.epsDiluted);
  const interestExpenseSeries = income.map((row) => row.interestExpense);
  const costOfRevenueSeries = income.map((row) => row.costOfRevenue);
  const sbcSeries = income.map((row) => row.stockBasedCompensation);
  const fcfSeries = cashflow.map((row) => row.freeCashFlow);
  const ocfSeries = cashflow.map((row) => row.operatingCashFlow);
  const sharesSeries = balance.map((row, index) => row.sharesOutstanding ?? income[index]?.sharesDiluted ?? income[index]?.sharesBasic ?? null);
  const warnedMissingShares = new Set<string>();

  const resolveShares = (index: number): number | null => {
    const direct = sharesSeries[index];
    if (direct !== null && Number.isFinite(direct) && direct > 0) {
      return direct;
    }
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = sharesSeries[cursor];
      if (candidate !== null && Number.isFinite(candidate) && candidate > 0) {
        return candidate;
      }
    }
    for (let cursor = index + 1; cursor < sharesSeries.length; cursor += 1) {
      const candidate = sharesSeries[cursor];
      if (candidate !== null && Number.isFinite(candidate) && candidate > 0) {
        return candidate;
      }
    }
    return null;
  };

  for (let i = 0; i < income.length; i += 1) {
    const inc = income[i];
    const bs = balance[i];
    const cf = cashflow[i];
    if (!bs || !cf || inc.periodEnd !== bs.periodEnd || inc.periodEnd !== cf.periodEnd) {
      warnings.push(`Ratio row skipped at index ${i}: period alignment mismatch.`);
      continue;
    }

    const periodEnd = inc.periodEnd;
    const priceAtPeriodEnd = findPeriodEndAdjClose(prices, periodEnd);
    const shares = resolveShares(i);
    if (shares === null && priceAtPeriodEnd !== null && !warnedMissingShares.has(periodEnd)) {
      warnings.push(`Shares outstanding unavailable at ${periodEnd}; market-cap-based ratios are partial.`);
      warnedMissingShares.add(periodEnd);
    }
    const marketCapAtPeriodEnd = priceAtPeriodEnd !== null && shares !== null ? priceAtPeriodEnd * shares : null;

    const ev = marketCapAtPeriodEnd !== null && bs.totalDebt !== null ? marketCapAtPeriodEnd + bs.totalDebt - bs.cash : null;
    const ttmRevenue = rolling4(revenueSeries, i);
    const ttmEbit = rolling4(ebitSeries, i);
    const ttmEbitda = rolling4(ebitdaSeries, i);
    const ttmNetIncome = rolling4(netIncomeSeries, i);
    const ttmFcf = rolling4(fcfSeries, i);
    const ttmOcF = rolling4(ocfSeries, i);
    const ttmInterestExpense = rolling4(interestExpenseSeries, i);
    const ttmCostOfRevenue = rolling4(costOfRevenueSeries, i);

    const ttmEps = rolling4(epsSeries, i);
    const peRatio = priceAtPeriodEnd !== null && ttmEps !== null
      ? safeDivide(priceAtPeriodEnd, ttmEps)
      : null;

    const enterpriseValue = ev;
    const evToEbitda = enterpriseValue !== null && ttmEbitda !== null && ttmEbitda > 0 ? enterpriseValue / ttmEbitda : null;
    const evToEbit = enterpriseValue !== null && ttmEbit !== null && ttmEbit > 0 ? enterpriseValue / ttmEbit : null;
    const evToRevenue = enterpriseValue !== null && ttmRevenue !== null && ttmRevenue > 0 ? enterpriseValue / ttmRevenue : null;
    const evToFCF = enterpriseValue !== null && ttmFcf !== null && ttmFcf > 0 ? enterpriseValue / ttmFcf : null;
    const priceToSales = marketCapAtPeriodEnd !== null && ttmRevenue !== null && ttmRevenue > 0 ? marketCapAtPeriodEnd / ttmRevenue : null;
    const priceToBook = marketCapAtPeriodEnd !== null && bs.stockholdersEquity > 0 ? marketCapAtPeriodEnd / bs.stockholdersEquity : null;
    const priceToFCF = marketCapAtPeriodEnd !== null && ttmFcf !== null && ttmFcf > 0 ? marketCapAtPeriodEnd / ttmFcf : null;
    const fcfYield = marketCapAtPeriodEnd !== null && ttmFcf !== null && marketCapAtPeriodEnd > 0 ? ttmFcf / marketCapAtPeriodEnd : null;

    const priorBs = i > 0 ? balance[i - 1] : null;
    const priorInvestedCapital = priorBs?.investedCapital ?? null;
    const avgInvestedCapital = bs.investedCapital !== null && priorInvestedCapital !== null
      ? (bs.investedCapital + priorInvestedCapital) / 2
      : bs.investedCapital;
    const nopatQuarter = inc.ebit * (1 - (inc.effectiveTaxRate ?? 0.21));
    const roic = avgInvestedCapital !== null && avgInvestedCapital > 0 ? ((nopatQuarter * 4) / avgInvestedCapital) : null;

    const avgEquity = priorBs ? (bs.stockholdersEquity + priorBs.stockholdersEquity) / 2 : bs.stockholdersEquity;
    const avgAssets = priorBs ? (bs.totalAssets + priorBs.totalAssets) / 2 : bs.totalAssets;
    const roe = ttmNetIncome !== null && avgEquity !== 0 ? ttmNetIncome / avgEquity : null;
    const roa = ttmNetIncome !== null && avgAssets !== 0 ? ttmNetIncome / avgAssets : null;
    const roceBase = bs.totalCurrentLiabilities !== null ? (bs.totalAssets - bs.totalCurrentLiabilities) : null;
    const roce = ttmEbit !== null && roceBase !== null && roceBase !== 0 ? ttmEbit / roceBase : null;
    const croic = ttmFcf !== null && bs.investedCapital !== null && bs.investedCapital > 0 ? ttmFcf / bs.investedCapital : null;

    const debtToEquity = bs.totalDebt !== null && bs.stockholdersEquity !== 0 ? bs.totalDebt / bs.stockholdersEquity : null;
    const netDebtToEbitda = bs.netDebt !== null && ttmEbitda !== null && ttmEbitda > 0 ? bs.netDebt / ttmEbitda : null;
    const interestCoverage = ttmEbit !== null && ttmInterestExpense !== null && ttmInterestExpense > 0
      ? ttmEbit / ttmInterestExpense
      : null;

    const currentRatio = safeDivide(bs.totalCurrentAssets, bs.totalCurrentLiabilities);
    const quickRatio = bs.totalCurrentAssets !== null && bs.inventory !== null && bs.totalCurrentLiabilities !== null
      ? safeDivide(bs.totalCurrentAssets - bs.inventory, bs.totalCurrentLiabilities)
      : null;
    const cashRatio = safeDivide(bs.cash, bs.totalCurrentLiabilities);

    const assetTurnover = ttmRevenue !== null ? safeDivide(ttmRevenue, avgAssets) : null;
    const priorInventory = priorBs?.inventory ?? null;
    const avgInventory = bs.inventory !== null && priorInventory !== null ? (bs.inventory + priorInventory) / 2 : bs.inventory;
    const priorReceivables = priorBs?.accountsReceivable ?? null;
    const avgReceivables = bs.accountsReceivable !== null && priorReceivables !== null
      ? (bs.accountsReceivable + priorReceivables) / 2
      : bs.accountsReceivable;
    const priorPayables = priorBs?.accountsPayable ?? null;
    const avgPayables = bs.accountsPayable !== null && priorPayables !== null
      ? (bs.accountsPayable + priorPayables) / 2
      : bs.accountsPayable;
    const inventoryTurnover = ttmCostOfRevenue !== null && ttmCostOfRevenue > 0 && avgInventory !== null && avgInventory > 0
      ? ttmCostOfRevenue / avgInventory
      : null;
    const receivablesTurnover = ttmRevenue !== null && ttmRevenue > 0 && avgReceivables !== null && avgReceivables > 0
      ? ttmRevenue / avgReceivables
      : null;
    const payablesTurnover = ttmCostOfRevenue !== null && ttmCostOfRevenue > 0 && avgPayables !== null && avgPayables > 0
      ? ttmCostOfRevenue / avgPayables
      : null;
    const dso = receivablesTurnover !== null && receivablesTurnover > 0 ? 365 / receivablesTurnover : null;
    const dio = inventoryTurnover !== null && inventoryTurnover > 0 ? 365 / inventoryTurnover : null;
    const dpo = payablesTurnover !== null && payablesTurnover > 0 ? 365 / payablesTurnover : null;
    const ccc = dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null;

    const accrualsRatio = ttmNetIncome !== null && ttmOcF !== null && avgAssets !== 0 ? (ttmNetIncome - ttmOcF) / avgAssets : null;
    const fcfConversion = ttmFcf !== null && ttmNetIncome !== null && ttmNetIncome !== 0 ? ttmFcf / ttmNetIncome : null;
    const sbcTtm = rolling4(sbcSeries, i);
    const sbcToRevenue = sbcTtm !== null && ttmRevenue !== null && ttmRevenue > 0 ? sbcTtm / ttmRevenue : null;

    rows.push({
      fiscalYear: inc.fiscalYear,
      fiscalQuarter: inc.fiscalQuarter,
      periodEnd,
      priceAtPeriodEnd,
      marketCapAtPeriodEnd,
      enterpriseValue,
      evToEbitda,
      evToEbit,
      evToRevenue,
      evToFCF,
      peRatio,
      priceToSales,
      priceToBook,
      priceToFCF,
      fcfYield,
      grossMargin: inc.grossMargin,
      ebitMargin: inc.ebitMargin,
      ebitdaMargin: inc.ebitdaMargin,
      netMargin: inc.netMargin,
      fcfMargin: cf.fcfMargin,
      roic,
      roe,
      roa,
      roce,
      croic,
      netDebtToEbitda,
      debtToEquity,
      interestCoverage,
      currentRatio,
      quickRatio,
      cashRatio,
      assetTurnover,
      inventoryTurnover,
      receivablesTurnover,
      daysSalesOutstanding: dso,
      daysInventoryOutstanding: dio,
      daysPayableOutstanding: dpo,
      cashConversionCycle: ccc,
      accrualsRatio,
      fcfConversion,
      sbcToRevenue
    });
  }

  return rows;
}

function computeTTM(income: QuarterlyIncome[], cashflow: QuarterlyCashFlow[], balance: QuarterlyBalanceSheet[]): TTMMetrics {
  const n = income.length - 1;
  const sumRecent = (series: Array<number | null>): number | null => {
    if (n < 0) return null;
    if (n >= 3) return rolling4(series, n);
    const slice = series.slice(0, n + 1);
    if (slice.length === 0 || slice.some((value) => value === null)) return null;
    return slice.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  };

  const revenue = sumRecent(income.map((row) => row.revenue)) ?? 0;
  const grossProfit = sumRecent(income.map((row) => row.grossProfit));
  const ebit = sumRecent(income.map((row) => row.ebit)) ?? 0;
  const ebitda = sumRecent(income.map((row) => row.ebitda));
  const netIncome = sumRecent(income.map((row) => row.netIncome)) ?? 0;
  const operatingCashFlow = sumRecent(cashflow.map((row) => row.operatingCashFlow)) ?? 0;
  const freeCashFlow = sumRecent(cashflow.map((row) => row.freeCashFlow));
  const capex = sumRecent(cashflow.map((row) => row.capex));
  const dividendsPaid = sumRecent(cashflow.map((row) => row.dividendsPaid));
  const shareBuybacks = sumRecent(cashflow.map((row) => row.shareBuybacks));
  const epsDiluted = sumRecent(income.map((row) => row.epsDiluted));
  const shares = balance[n]?.sharesOutstanding ?? income[n]?.sharesDiluted ?? null;
  const fcfPerShare = safeDivide(freeCashFlow, shares);
  const revenuePerShare = safeDivide(revenue, shares);

  return {
    revenue,
    grossProfit,
    ebit,
    ebitda,
    netIncome,
    operatingCashFlow,
    freeCashFlow,
    capex,
    dividendsPaid,
    shareBuybacks,
    grossMargin: safeDivide(grossProfit, revenue),
    ebitMargin: safeDivide(ebit, revenue),
    ebitdaMargin: safeDivide(ebitda, revenue),
    netMargin: safeDivide(netIncome, revenue),
    fcfMargin: safeDivide(freeCashFlow, revenue),
    epsDiluted,
    fcfPerShare,
    revenuePerShare
  };
}

function computeGrowth(income: QuarterlyIncome[], cashflow: QuarterlyCashFlow[]): GrowthMetrics {
  const n = income.length - 1;
  const priorQuarter = n > 0 ? income[n - 1] : null;
  const priorYear = n >= 4 ? income[n - 4] : null;
  const priorYearCf = n >= 4 ? cashflow[n - 4] : null;

  const revenueGrowthYoY = priorYear ? safeGrowth(income[n].revenue, priorYear.revenue) : null;
  const revenueGrowthQoQ = priorQuarter ? safeGrowth(income[n].revenue, priorQuarter.revenue) : null;
  const grossProfitGrowthYoY = priorYear ? safeGrowth(income[n].grossProfit, priorYear.grossProfit) : null;
  const ebitGrowthYoY = priorYear ? safeGrowth(income[n].ebit, priorYear.ebit) : null;
  const ebitdaGrowthYoY = priorYear ? safeGrowth(income[n].ebitda, priorYear.ebitda) : null;
  const netIncomeGrowthYoY = priorYear ? safeGrowth(income[n].netIncome, priorYear.netIncome) : null;
  const epsGrowthYoY = priorYear ? safeGrowth(income[n].epsDiluted, priorYear.epsDiluted) : null;
  const fcfGrowthYoY = priorYearCf ? safeGrowth(cashflow[n].freeCashFlow, priorYearCf.freeCashFlow) : null;

  const qoqRevCurrent = priorQuarter ? safeGrowth(income[n].revenue, priorQuarter.revenue) : null;
  const qoqRevPrior = n >= 2 ? safeGrowth(income[n - 1].revenue, income[n - 2].revenue) : null;
  const qoqEpsCurrent = n >= 1 ? safeGrowth(income[n].epsDiluted, income[n - 1].epsDiluted) : null;
  const qoqEpsPrior = n >= 2 ? safeGrowth(income[n - 1].epsDiluted, income[n - 2].epsDiluted) : null;

  return {
    revenueGrowthYoY,
    revenueGrowthQoQ,
    revenueCagr3Y: null,
    grossProfitGrowthYoY,
    ebitGrowthYoY,
    ebitdaGrowthYoY,
    netIncomeGrowthYoY,
    epsGrowthYoY,
    fcfGrowthYoY,
    epsCagr3Y: null,
    revenueCagr5Y: null,
    revenueAcceleration: qoqRevCurrent !== null && qoqRevPrior !== null ? qoqRevCurrent - qoqRevPrior : null,
    epsAcceleration: qoqEpsCurrent !== null && qoqEpsPrior !== null ? qoqEpsCurrent - qoqEpsPrior : null,
    grossMarginExpansionYoY:
      priorYear !== null && priorYear.grossMargin !== null && income[n].grossMargin !== null
        ? income[n].grossMargin - priorYear.grossMargin
        : null,
    ebitMarginExpansionYoY:
      priorYear !== null && priorYear.ebitMargin !== null && income[n].ebitMargin !== null
        ? income[n].ebitMargin - priorYear.ebitMargin
        : null,
    netMarginExpansionYoY:
      priorYear !== null && priorYear.netMargin !== null && income[n].netMargin !== null
        ? income[n].netMargin - priorYear.netMargin
        : null
  };
}

function safeGrowth(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function computePriceHistory(prices: PricePoint[], spyPrices: PricePoint[]): PriceHistory {
  const closes = prices.map((row) => row.adjClose);
  const volumes = prices.map((row) => row.volume);
  const ma50 = simpleMovingAverage(closes, 50);
  const ma200 = simpleMovingAverage(closes, 200);
  const latest = closes.at(-1) ?? null;
  const latestVolume = volumes.at(-1) ?? null;
  const avgVolume30D = average(volumes.slice(-30));
  const avgVolume90D = average(volumes.slice(-90));
  const rsi14 = computeRsi(closes, 14);
  const high52W = maxNullable(closes.slice(-252));
  const low52W = minNullable(closes.slice(-252));
  const momentum12_2 = computeMomentum12_2(closes);

  const beta1Y = computeBeta(prices, spyPrices);

  return {
    daily: prices,
    beta1Y,
    high52W,
    low52W,
    avgVolume30D,
    avgVolume90D,
    ma50,
    ma200,
    rsi14,
    priceVsMa200Pct: latest !== null && ma200 !== null && ma200 !== 0 ? (latest - ma200) / ma200 : null,
    volumeRatio: latestVolume !== null && avgVolume90D !== null && avgVolume90D > 0 ? latestVolume / avgVolume90D : null,
    momentum12_2
  };
}

function simpleMovingAverage(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return average(slice);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  const avg = sum / values.length;
  return Number.isFinite(avg) ? avg : null;
}

function maxNullable(values: number[]): number | null {
  if (values.length === 0) return null;
  const value = Math.max(...values);
  return Number.isFinite(value) ? value : null;
}

function minNullable(values: number[]): number | null {
  if (values.length === 0) return null;
  const value = Math.min(...values);
  return Number.isFinite(value) ? value : null;
}

function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeMomentum12_2(closes: number[]): number | null {
  if (closes.length < 252) return null;
  const tMinus21 = closes.at(-21);
  const tMinus252 = closes.at(-252);
  if (tMinus21 === undefined || tMinus252 === undefined || tMinus252 === 0) return null;
  return (tMinus21 - tMinus252) / tMinus252;
}

function computeBeta(prices: PricePoint[], spyPrices: PricePoint[]): number | null {
  const stockReturns = buildReturnsByDate(prices);
  const benchReturns = buildReturnsByDate(spyPrices);
  const dates = Array.from(stockReturns.keys()).filter((date) => benchReturns.has(date)).sort();
  const recent = dates.slice(-252);
  if (recent.length < 60) return null;

  const x: number[] = [];
  const y: number[] = [];
  for (const date of recent) {
    const sx = stockReturns.get(date);
    const by = benchReturns.get(date);
    if (sx === undefined || by === undefined) continue;
    x.push(sx);
    y.push(by);
  }
  if (x.length < 60) return null;

  const meanX = average(x);
  const meanY = average(y);
  if (meanX === null || meanY === null) return null;

  let covariance = 0;
  let varianceY = 0;
  for (let i = 0; i < x.length; i += 1) {
    covariance += (x[i] - meanX) * (y[i] - meanY);
    varianceY += (y[i] - meanY) ** 2;
  }
  if (varianceY === 0) return null;
  return covariance / varianceY;
}

function buildReturnsByDate(points: PricePoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]?.adjClose;
    const curr = points[i]?.adjClose;
    if (prev === undefined || curr === undefined || prev === 0) continue;
    map.set(points[i].date, (curr - prev) / prev);
  }
  return map;
}

function deriveConfidence(imputedFields: string[], warnings: string[]): "high" | "medium" | "low" {
  if (imputedFields.length <= 4 && warnings.length <= 8) return "high";
  if (imputedFields.length <= 12 && warnings.length <= 20) return "medium";
  return "low";
}

function recordFieldSource(
  trace: Record<string, string>,
  field: string,
  pick: FactPick
): void {
  if (!pick.tag) return;
  const unitPart = pick.unit ? ` [${pick.unit}]` : "";
  const formPart = pick.form ? ` · ${pick.form}` : "";
  trace[field] = `${pick.tag}${unitPart}${formPart}`;
}

function backfillLatestFieldSourceTrace(
  trace: Record<string, string>,
  periodEnd: string,
  factsGaap: Record<string, { units?: Record<string, EdgarFactRow[]> }>,
  tags: XbrlTagMap,
  monetaryUnits: string[]
): void {
  const noWarnings: string[] = [];

  const ensureField = (field: string, pick: FactPick): void => {
    if (trace[field]) return;
    recordFieldSource(trace, field, pick);
  };

  ensureField("revenue", pickFact(factsGaap, tags.revenue, periodEnd, monetaryUnits, noWarnings));
  ensureField("ebit", pickFact(factsGaap, tags.ebit, periodEnd, monetaryUnits, noWarnings));
  ensureField("netIncome", pickFact(factsGaap, tags.netIncome, periodEnd, monetaryUnits, noWarnings));
  ensureField("cash", pickFact(factsGaap, tags.cash, periodEnd, monetaryUnits, noWarnings));
  ensureField("totalAssets", pickFact(factsGaap, tags.totalAssets, periodEnd, monetaryUnits, noWarnings));
  ensureField(
    "stockholdersEquity",
    pickFact(factsGaap, tags.stockholdersEquity, periodEnd, monetaryUnits, noWarnings)
  );
  ensureField(
    "operatingCashFlow",
    pickFact(factsGaap, tags.operatingCashFlow, periodEnd, monetaryUnits, noWarnings)
  );
}

function applyAnomalyWarnings(financials: CompanyFinancials): void {
  const warnings = financials.warnings;
  const income = financials.income;
  const balance = financials.balance;
  const cashflow = financials.cashflow;

  for (let i = 1; i < income.length; i += 1) {
    const prev = income[i - 1];
    const curr = income[i];
    if (prev.revenue !== 0) {
      const qoq = (curr.revenue - prev.revenue) / Math.abs(prev.revenue);
      if (qoq > 5) {
        warnings.push(`Revenue QoQ growth ${(qoq * 100).toFixed(1)}% at ${curr.periodEnd} (possible acquisition/restatement).`);
      }
    }
    if (curr.netMargin !== null && curr.netMargin > 0.6) {
      warnings.push(`Unusually high net margin ${(curr.netMargin * 100).toFixed(1)}% at ${curr.periodEnd}.`);
    }

    const prevShares = prev.sharesDiluted ?? prev.sharesBasic ?? null;
    const currShares = curr.sharesDiluted ?? curr.sharesBasic ?? null;
    if (prevShares !== null && currShares !== null && prevShares > 0) {
      const shareDelta = Math.abs(currShares - prevShares) / prevShares;
      if (shareDelta > 0.2) {
        warnings.push(`Share count changed ${(shareDelta * 100).toFixed(1)}% QoQ at ${curr.periodEnd} (split/buyback/dilution check).`);
      }
    }
  }

  for (let i = 1; i < balance.length; i += 1) {
    const prev = balance[i - 1];
    const curr = balance[i];
    if (prev.totalAssets > 0) {
      const assetDelta = Math.abs(curr.totalAssets - prev.totalAssets) / prev.totalAssets;
      if (assetDelta > 1) {
        warnings.push(`Total assets changed ${(assetDelta * 100).toFixed(1)}% at ${curr.periodEnd} (possible major M&A/restate).`);
      }
    }
  }

  let negativeCfoStreak = 0;
  for (const row of cashflow) {
    if (row.operatingCashFlow < 0) {
      negativeCfoStreak += 1;
      if (negativeCfoStreak >= 4) {
        warnings.push(`Operating cash flow negative for ${negativeCfoStreak} consecutive quarters through ${row.periodEnd}.`);
        break;
      }
    } else {
      negativeCfoStreak = 0;
    }
  }
}

function validateFinancials(financials: CompanyFinancials): void {
  for (let i = 1; i < financials.income.length; i += 1) {
    if (financials.income[i].periodEnd <= financials.income[i - 1].periodEnd) {
      throw new Error(`Income out of order at index ${i}`);
    }
  }

  for (let i = 0; i < financials.balance.length; i += 1) {
    const bs = financials.balance[i];
    if (bs.totalLiabilities !== null) {
      const rhs = bs.totalLiabilities + bs.stockholdersEquity;
      if (bs.totalAssets !== 0) {
        const diff = Math.abs(bs.totalAssets - rhs) / Math.abs(bs.totalAssets);
        if (diff > 0.02) {
          financials.warnings.push(`BS identity gap ${(diff * 100).toFixed(1)}% at ${bs.periodEnd}`);
        }
      }
    }
  }

  const firstRevenue = financials.income[0]?.revenue ?? 0;
  if (firstRevenue < 1_000_000) {
    financials.warnings.push(
      `Revenue looks small for S&P 500 universe (${firstRevenue}). Flagging possible unit/tag issue instead of hard-failing.`
    );
  }
  if (firstRevenue > 5_000_000_000_000) {
    throw new Error(`Revenue looks over-scaled (possible unit multiplier error): ${firstRevenue}`);
  }

  if (financials.income.length < 2) {
    throw new Error(`Need 2+ quarters, got ${financials.income.length}`);
  }
  if (financials.income.length < 4) {
    financials.warnings.push(`Partial filing history: ${financials.income.length} quarters available (<4).`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEC + MARKET DATA FETCH
// ─────────────────────────────────────────────────────────────────────────────

function getSecHeaders(): Record<string, string> {
  const contact = readEnvToken("SEC_CONTACT_EMAIL") ?? readEnvToken("ELDAR_CONTACT_EMAIL") ?? "contact@eldar.app";
  return {
    "User-Agent": `ELDAR/1.0 ${contact}`,
    Accept: "application/json"
  };
}

async function waitForSecRateLimit(): Promise<void> {
  secRateLimitQueue = secRateLimitQueue
    .catch(() => undefined)
    .then(async () => {
      const now = Date.now();
      const gateUntil = Math.max(secNextAllowedAtMs, secGlobalCooldownUntilMs);
      const waitMs = Math.max(0, gateUntil - now);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      const jitterMs = SEC_JITTER_MS > 0 ? Math.floor(Math.random() * (SEC_JITTER_MS + 1)) : 0;
      if (jitterMs > 0) {
        await sleep(jitterMs);
      }
      secNextAllowedAtMs = Date.now() + secAdaptiveIntervalMs;
    });

  await secRateLimitQueue;
}

function registerSecSuccess(): void {
  if (secAdaptiveIntervalMs <= SEC_BASE_INTERVAL_MS) {
    secAdaptiveIntervalMs = SEC_BASE_INTERVAL_MS;
    return;
  }
  secAdaptiveIntervalMs = Math.max(SEC_BASE_INTERVAL_MS, Math.floor(secAdaptiveIntervalMs * 0.92));
}

function registerSecThrottle(attempt: number, retryAfterMs: number | null): number {
  const exponentialMs = Math.min(60_000, 1_500 * 2 ** attempt);
  const cooldownMs = Math.max(retryAfterMs ?? 0, SEC_COOLDOWN_FLOOR_MS, exponentialMs);

  secGlobalCooldownUntilMs = Math.max(secGlobalCooldownUntilMs, Date.now() + cooldownMs);
  secAdaptiveIntervalMs = Math.min(
    SEC_MAX_INTERVAL_MS,
    Math.max(SEC_BASE_INTERVAL_MS + 20, Math.round(secAdaptiveIntervalMs * 1.35 + 40))
  );

  return cooldownMs;
}

function registerSecTransientFailure(attempt: number): number {
  secAdaptiveIntervalMs = Math.min(SEC_MAX_INTERVAL_MS, Math.round(secAdaptiveIntervalMs * 1.12 + 20));
  return Math.min(20_000, 700 * 2 ** attempt);
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numericSeconds = Number.parseInt(trimmed, 10);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1_000;
  }

  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return null;
  const delta = retryAt - Date.now();
  return delta > 0 ? delta : 0;
}

async function secFetchJson<T>(url: string): Promise<T> {
  const retries = 6;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    await waitForSecRateLimit();

    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        signal: getFetchSignal(SEC_TIMEOUT_MS),
        headers: getSecHeaders()
      });
    } catch (error) {
      const backoffMs = registerSecTransientFailure(attempt);
      if (attempt === retries - 1) {
        throw new SecUnavailableError(`SEC request failed (network): ${toErrorMessage(error)} ${url}`, null, url);
      }
      await sleep(backoffMs);
      continue;
    }

    if (response.ok) {
      registerSecSuccess();
      return (await response.json()) as T;
    }

    lastStatus = response.status;
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const backoffMs = registerSecThrottle(attempt, retryAfterMs);
      if (attempt === retries - 1) {
        throw new SecUnavailableError(`SEC request failed (429) ${url}`, response.status, url);
      }
      await sleep(backoffMs);
      continue;
    }

    if (response.status >= 500 || response.status === 408 || response.status === 425) {
      const backoffMs = registerSecTransientFailure(attempt);
      if (attempt === retries - 1) {
        throw new SecUnavailableError(`SEC request failed (${response.status}) ${url}`, response.status, url);
      }
      await sleep(backoffMs);
      continue;
    }

    throw new Error(`SEC request failed (${response.status}) ${url}`);
  }

  if (lastStatus !== null) {
    throw new SecUnavailableError(`SEC request failed (${lastStatus}) ${url}`, lastStatus, url);
  }

  throw new SecUnavailableError(`SEC request failed: ${url}`, null, url);
}

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

async function fetchYahooDailyPrices(ticker: string): Promise<ProviderPriceRow[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(toYahooSymbol(ticker))}`);
  url.searchParams.set("range", "2y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url.toString(), {
    cache: "no-store",
    signal: getFetchSignal(PRICE_FETCH_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      "User-Agent": "ELDAR/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Yahoo chart request failed (${response.status}) for ${ticker}`);
  }

  const payload = (await response.json()) as YahooChartPayload;
  const result = payload.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0];
  const adjclose = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!quote) return [];

  const rows: ProviderPriceRow[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    const open = quote.open?.[i] ?? null;
    const high = quote.high?.[i] ?? null;
    const low = quote.low?.[i] ?? null;
    const close = quote.close?.[i] ?? null;
    const volume = quote.volume?.[i] ?? null;
    const adj = adjclose?.[i] ?? close;
    if (
      !Number.isFinite(ts) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(adj) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }
    const tsNumber = ts as number;
    const openNumber = open as number;
    const highNumber = high as number;
    const lowNumber = low as number;
    const closeNumber = close as number;
    const adjNumber = adj as number;
    const volumeNumber = volume as number;

    rows.push({
      date: new Date(tsNumber * 1000).toISOString(),
      open: openNumber,
      high: highNumber,
      low: lowNumber,
      close: closeNumber,
      adjClose: adjNumber,
      volume: volumeNumber
    });
  }

  return rows;
}

async function fetchYahooQuote(ticker: string): Promise<ProviderQuoteRow | null> {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(toYahooSymbol(ticker))}`);
    url.searchParams.set("range", "5d");
    url.searchParams.set("interval", "1d");

    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: getFetchSignal(PRICE_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": "ELDAR/1.0"
      }
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number | null;
            regularMarketTime?: number | null;
          };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
            }>;
          };
        }>;
      };
    };
    const result = payload.chart?.result?.[0];
    if (!result) return null;

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const latestClose = [...closes].reverse().find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;
    const last = latestClose ?? parseOptionalNumber(result.meta?.regularMarketPrice);
    const regularMarketTime =
      (typeof timestamps[timestamps.length - 1] === "number" ? timestamps[timestamps.length - 1] : null) ??
      parseOptionalNumber(result.meta?.regularMarketTime);

    return {
      source: "YAHOO_FALLBACK",
      ticker,
      last: last ?? undefined,
      timestamp: regularMarketTime ? new Date(regularMarketTime * 1000).toISOString() : undefined
    };
  } catch {
    return null;
  }
}

function mapHistorySourceToPriceSource(source: string | null): Exclude<PriceSource, "YAHOO_FALLBACK"> | null {
  if (source === "ALPACA") return "ALPACA";
  if (source === "TWELVEDATA") return "TWELVEDATA";
  if (source === "MARKETSTACK") return "MARKETSTACK";
  if (source === "ALPHA_VANTAGE") return "ALPHA_VANTAGE";
  return null;
}

function normalizeFallbackHistoryToProviderRows(points: Array<{ date: Date; close: number | null }>): ProviderPriceRow[] {
  const rows: ProviderPriceRow[] = [];
  for (const point of points) {
    const close = point.close;
    if (close === null || !Number.isFinite(close) || close <= 0) continue;
    const date = point.date;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    rows.push({
      date: date.toISOString(),
      open: close,
      high: close,
      low: close,
      close,
      adjClose: close,
      volume: 0
    });
  }
  rows.sort((a, b) => parseDate(a.date ?? "") - parseDate(b.date ?? ""));
  return rows;
}

async function computeRankedDailyPrices(ticker: string): Promise<RankedDailyPriceResult> {
  // Historical fallback hierarchy (build phase):
  // 1) Alpaca, 2) Twelve Data, 3) marketstack, 4) Alpha Vantage, 5) Yahoo.
  const fallback = await fetchTemporaryHistoryFallback(ticker, {
    range: "2y",
    interval: "1d",
    minimumPoints: PRICE_HISTORY_MIN_POINTS
  });

  const fallbackSource = mapHistorySourceToPriceSource(fallback.source ?? null);
  const fallbackRows = normalizeFallbackHistoryToProviderRows(fallback.points);

  if (fallbackSource && fallbackRows.length >= PRICE_HISTORY_MIN_POINTS) {
    return {
      rows: fallbackRows,
      source: fallbackSource,
      warning: null
    };
  }

  const yahooRows = await retryAsync(() => fetchYahooDailyPrices(ticker), 3, 220).catch(() => []);
  if (yahooRows.length > 0) {
    const warning =
      fallbackSource && fallbackRows.length > 0
        ? `TEMPORARY: ${fallbackSource} daily history for ${ticker} returned ${fallbackRows.length} points; using Yahoo fallback for fuller history.`
        : null;
    return {
      rows: yahooRows,
      source: "YAHOO_FALLBACK",
      warning
    };
  }

  if (fallbackSource && fallbackRows.length > 0) {
    return {
      rows: fallbackRows,
      source: fallbackSource,
      warning: `TEMPORARY: Yahoo history unavailable for ${ticker}; using partial ${fallbackSource} history (${fallbackRows.length} points).`
    };
  }

  return {
    rows: [],
    source: "YAHOO_FALLBACK",
    warning: `TEMPORARY: no history provider returned usable data for ${ticker}.`
  };
}

async function fetchRankedDailyPrices(ticker: string): Promise<RankedDailyPriceResult> {
  const key = normalizePriceCacheKey(ticker);
  const now = Date.now();
  const cached = rankedDailyPriceCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cloneRankedDailyPriceResult(cached.value);
  }

  const inFlight = rankedDailyPriceInFlight.get(key);
  if (inFlight) {
    return cloneRankedDailyPriceResult(await inFlight);
  }

  const run = computeRankedDailyPrices(ticker);
  rankedDailyPriceInFlight.set(key, run);
  try {
    const resolved = await run;
    rankedDailyPriceCache.set(key, {
      expiresAt: Date.now() + PRICE_HISTORY_CACHE_TTL_MS,
      value: cloneRankedDailyPriceResult(resolved)
    });
    return cloneRankedDailyPriceResult(resolved);
  } finally {
    rankedDailyPriceInFlight.delete(key);
  }
}

async function fetchRankedQuote(ticker: string): Promise<ProviderQuoteRow | null> {
  const key = normalizePriceCacheKey(ticker);
  const now = Date.now();
  const cached = rankedQuoteCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value ? { ...cached.value } : null;
  }

  const inFlight = rankedQuoteInFlight.get(key);
  if (inFlight) {
    const awaited = await inFlight;
    return awaited ? { ...awaited } : null;
  }

  const run = (async (): Promise<ProviderQuoteRow | null> => {
    const yahoo = await retryAsync(() => fetchYahooQuote(ticker), 2, 180).catch(() => null);
    if (yahoo?.last !== undefined && yahoo.last !== null) {
      return yahoo;
    }

    const fallback = await fetchTemporaryQuoteFallback(ticker, { fast: true });
    if (fallback.price !== null) {
      const source = mapHistorySourceToPriceSource(fallback.source ?? null) ?? "YAHOO_FALLBACK";
      return {
        source,
        last: fallback.price,
        timestamp: fallback.asOfMs !== null ? new Date(fallback.asOfMs).toISOString() : undefined
      };
    }

    return null;
  })();

  rankedQuoteInFlight.set(key, run);
  try {
    const resolved = await run;
    rankedQuoteCache.set(key, {
      expiresAt: Date.now() + PRICE_QUOTE_CACHE_TTL_MS,
      value: resolved ? { ...resolved } : null
    });
    return resolved ? { ...resolved } : null;
  } finally {
    rankedQuoteInFlight.delete(key);
  }
}

async function resolveCikForTicker(ticker: string): Promise<string | null> {
  const map = await fetchSecTickerMap();
  const normalized = normalizeTicker(ticker);
  const candidates = Array.from(new Set([normalized, normalized.replace(/\./g, "-"), normalized.replace(/-/g, ".")]));
  for (const candidate of candidates) {
    const cik = map.get(candidate.toUpperCase());
    if (cik) return cik;
  }
  for (const candidate of candidates) {
    const cik = SEC_CIK_OVERRIDES[candidate.toUpperCase()];
    if (cik) return cik;
  }
  return null;
}

async function fetchSecTickerMap(): Promise<Map<string, string>> {
  if (!secTickerMapPromise) {
    secTickerMapPromise = (async () => {
      const map = new Map<string, string>();

      const [primaryResult, exchangeResult] = await Promise.allSettled([
        secFetchJson<Record<string, EdgarTickerRow>>(SEC_TICKERS_URL),
        secFetchJson<EdgarTickerExchangePayload>(SEC_TICKERS_EXCHANGE_URL)
      ]);

      if (primaryResult.status === "fulfilled") {
        for (const row of Object.values(primaryResult.value)) {
          const ticker = trimOrNull(row.ticker);
          const cik = typeof row.cik_str === "number" ? String(Math.trunc(row.cik_str)).padStart(10, "0") : null;
          if (!ticker || !cik) continue;
          const normalized = normalizeTicker(ticker);
          map.set(normalized, cik);
          map.set(normalized.replace(/-/g, "."), cik);
        }
      }

      if (exchangeResult.status === "fulfilled") {
        const fields = exchangeResult.value.fields ?? [];
        const rows = exchangeResult.value.data ?? [];
        const tickerIndex = fields.findIndex((field) => field.toLowerCase() === "ticker");
        const cikIndex = fields.findIndex((field) => field.toLowerCase() === "cik");

        if (tickerIndex >= 0 && cikIndex >= 0) {
          for (const row of rows) {
            const tickerRaw = row[tickerIndex];
            const cikRaw = row[cikIndex];
            const tickerValue = typeof tickerRaw === "string" ? tickerRaw : null;
            const cikNum =
              typeof cikRaw === "number"
                ? Math.trunc(cikRaw)
                : typeof cikRaw === "string"
                  ? Number.parseInt(cikRaw, 10)
                  : Number.NaN;
            const cik = Number.isFinite(cikNum) ? String(cikNum).padStart(10, "0") : null;
            const ticker = trimOrNull(tickerValue);
            if (!ticker || !cik) continue;
            const normalized = normalizeTicker(ticker);
            if (!map.has(normalized)) {
              map.set(normalized, cik);
            }
            const dotted = normalized.replace(/-/g, ".");
            if (!map.has(dotted)) {
              map.set(dotted, cik);
            }
          }
        }
      }

      for (const [ticker, cik] of Object.entries(SEC_CIK_OVERRIDES)) {
        const normalized = normalizeTicker(ticker);
        map.set(normalized, cik);
        map.set(normalized.replace(/-/g, "."), cik);
      }

      if (map.size === 0) {
        throw new Error("SEC ticker map empty after primary+exchange fetch.");
      }

      return map;
    })().catch((error) => {
      secTickerMapPromise = null;
      throw error;
    });
  }
  return secTickerMapPromise;
}

async function fetchSecSubmissions(cik: string): Promise<EdgarSubmissionsResponse> {
  return secFetchJson<EdgarSubmissionsResponse>(`${SEC_SUBMISSIONS_URL}/CIK${cik}.json`);
}

async function fetchSecCompanyFacts(cik: string): Promise<EdgarCompanyFactsResponse> {
  return secFetchJson<EdgarCompanyFactsResponse>(`${SEC_COMPANY_FACTS_URL}/CIK${cik}.json`);
}

function buildTargetPeriods(submissions: EdgarSubmissionsResponse, count: number): FiscalPeriodMeta[] {
  const forms = submissions.filings?.recent?.form ?? [];
  const periodOfReport = submissions.filings?.recent?.periodOfReport ?? [];
  const reportDate = submissions.filings?.recent?.reportDate ?? [];
  const filedDate = submissions.filings?.recent?.filingDate ?? [];
  const rows: FiscalPeriodMeta[] = [];
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    const period = trimOrNull(periodOfReport[i]) ?? trimOrNull(reportDate[i]);
    const filed = trimOrNull(filedDate[i]);
    if (!period || !filed) continue;
    if (form !== "10-Q" && form !== "10-K") continue;
    rows.push({
      periodEnd: period,
      formType: form,
      filedDate: filed
    });
  }

  const deduped = new Map<string, FiscalPeriodMeta>();
  for (const row of rows) {
    const existing = deduped.get(row.periodEnd);
    if (!existing || row.filedDate > existing.filedDate) {
      deduped.set(row.periodEnd, row);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .slice(-count);
}

function pickFact(
  facts: Record<string, { units?: Record<string, EdgarFactRow[]> }>,
  tags: readonly string[],
  periodEnd: string,
  units: string[],
  warnings: string[],
  scaleByUnit = true
): FactPick {
  const allowedForms = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);
  const targetPeriodMs = parseDate(periodEnd);
  const dateToleranceMs = 10 * 24 * 60 * 60 * 1000;

  const isAllowedForm = (row: EdgarFactRow): boolean => !row.form || allowedForms.has(row.form);

  const resolveUnitKeys = (unitsRecord: Record<string, EdgarFactRow[]>, requestedUnits: string[]): string[] => {
    const exact = requestedUnits.filter((unit) => Array.isArray(unitsRecord[unit]) && unitsRecord[unit].length > 0);
    if (exact.length > 0) return exact;

    const keys = Object.keys(unitsRecord);
    const normalizedRequested = requestedUnits.map((unit) => unit.trim().toLowerCase());
    const inferred = keys.filter((key) => {
      const normalized = key.trim().toLowerCase();
      if (normalizedRequested.includes("usd") && normalized.includes("usd")) return true;
      if (normalizedRequested.includes("shares") && normalized.includes("share")) return true;
      if (normalizedRequested.includes("usd/shares") && normalized.includes("usd") && normalized.includes("share")) return true;
      if (normalizedRequested.includes("pure") && (normalized === "pure" || normalized === "unitless")) return true;
      return false;
    });

    return inferred;
  };

  const selectCandidates = (rows: EdgarFactRow[]): EdgarFactRow[] => {
    const exact = rows.filter((row) => row.end === periodEnd && isAllowedForm(row));
    if (exact.length > 0) {
      return exact;
    }

    if (!Number.isFinite(targetPeriodMs) || targetPeriodMs <= 0) {
      return [];
    }

    const near = rows.filter((row) => {
      if (!row.end || !isAllowedForm(row)) return false;
      const endMs = parseDate(row.end);
      if (!Number.isFinite(endMs) || endMs <= 0) return false;
      return Math.abs(endMs - targetPeriodMs) <= dateToleranceMs;
    });
    if (near.length === 0) {
      return [];
    }

    let minDiff = Number.POSITIVE_INFINITY;
    for (const row of near) {
      const endMs = parseDate(row.end ?? "");
      const diff = Math.abs(endMs - targetPeriodMs);
      if (diff < minDiff) minDiff = diff;
    }

    return near.filter((row) => {
      const endMs = parseDate(row.end ?? "");
      const diff = Math.abs(endMs - targetPeriodMs);
      return diff === minDiff;
    });
  };

  for (const tag of tags) {
    const unitsRecord = facts[tag]?.units;
    if (!unitsRecord) continue;
    const candidateUnits = resolveUnitKeys(unitsRecord, units);
    for (const unit of candidateUnits) {
      const rows = unitsRecord[unit];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const candidates = selectCandidates(rows);
      if (candidates.length === 0) continue;

      let latest: EdgarFactRow | null = null;
      let earliest: EdgarFactRow | null = null;
      for (const row of candidates) {
        if (typeof row.val !== "number" || !Number.isFinite(row.val)) continue;
        if (!latest || (trimOrNull(row.filed) ?? "") >= (trimOrNull(latest.filed) ?? "")) latest = row;
        if (!earliest || (trimOrNull(row.filed) ?? "") <= (trimOrNull(earliest.filed) ?? "")) earliest = row;
      }
      if (!latest || latest.val === undefined) continue;

      const latestVal = scaleByUnit ? latest.val * unitMultiplier(unit) : latest.val;
      let restated = false;
      if (earliest && earliest.val !== undefined && earliest.val !== 0) {
        const diff = Math.abs(latest.val - earliest.val) / Math.abs(earliest.val);
        if (diff > 0.01) {
          restated = true;
          warnings.push(`Restatement ${tag} at ${periodEnd}: ${earliest.val} -> ${latest.val}`);
        }
      }

      return {
        value: latestVal,
        restated,
        tag,
        unit,
        form: trimOrNull(latest.form) ?? undefined,
        filed: trimOrNull(latest.filed) ?? undefined
      };
    }
  }

  return { value: null, restated: false };
}

function pickShareCountFact(
  facts: Record<string, { units?: Record<string, EdgarFactRow[]> }>,
  tags: readonly string[],
  periodEnd: string,
  warnings: string[]
): number | null {
  const direct = pickFact(facts, tags, periodEnd, ["shares"], warnings, false).value;
  if (direct !== null && Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const allowedForms = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);
  const targetMs = parseDate(periodEnd);
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    return null;
  }

  let bestPrior: { endMs: number; filed: string; value: number } | null = null;
  let bestFuture: { endMs: number; filed: string; value: number } | null = null;
  const futureToleranceMs = 120 * 24 * 60 * 60 * 1000;

  for (const tag of tags) {
    const unitsRecord = facts[tag]?.units;
    if (!unitsRecord) continue;
    for (const [unit, rows] of Object.entries(unitsRecord)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      if (!unit.toLowerCase().includes("share")) continue;

      for (const row of rows) {
        if (row.form && !allowedForms.has(row.form)) continue;
        if (typeof row.val !== "number" || !Number.isFinite(row.val) || row.val <= 0) continue;
        const endMs = parseDate(row.end ?? "");
        if (!Number.isFinite(endMs) || endMs <= 0) continue;

        const filed = trimOrNull(row.filed) ?? "";
        if (endMs <= targetMs) {
          if (!bestPrior || endMs > bestPrior.endMs || (endMs === bestPrior.endMs && filed > bestPrior.filed)) {
            bestPrior = { endMs, filed, value: row.val * unitMultiplier(unit) };
          }
          continue;
        }

        const distance = endMs - targetMs;
        if (distance > futureToleranceMs) continue;
        if (!bestFuture || endMs < bestFuture.endMs || (endMs === bestFuture.endMs && filed > bestFuture.filed)) {
          bestFuture = { endMs, filed, value: row.val * unitMultiplier(unit) };
        }
      }
    }
  }

  const picked = bestPrior ?? bestFuture;
  if (!picked) return null;

  warnings.push(
    `Shares fallback used near ${periodEnd}: selected nearest filed share count for market-cap continuity.`
  );
  return picked.value;
}

function unitMultiplier(unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return 1;
  if (normalized === "usd" || normalized === "shares" || normalized === "usd/shares" || normalized === "pure") {
    return 1;
  }
  if (normalized.includes("thousand")) return 1_000;
  if (normalized === "usdm" || normalized === "usdmm" || normalized.includes("million")) return 1_000_000;
  if (normalized === "usdb" || normalized.includes("billion")) return 1_000_000_000;
  return 1;
}

function normalizeAnnualQ4Flows(
  incomeRows: QuarterlyIncome[],
  cashflowRows: QuarterlyCashFlow[],
  warnings: string[]
): { income: QuarterlyIncome[]; cashflow: QuarterlyCashFlow[] } {
  const income = incomeRows.map((row) => ({ ...row }));
  const cashflow = cashflowRows.map((row) => ({ ...row }));
  const incomeByPeriod = new Map(income.map((row) => [row.periodEnd, row]));
  const cashflowByPeriod = new Map(cashflow.map((row) => [row.periodEnd, row]));

  const byFiscalYear = new Map<number, { q1?: string; q2?: string; q3?: string; q4?: string }>();
  for (const row of income) {
    const bucket = byFiscalYear.get(row.fiscalYear) ?? {};
    if (row.fiscalQuarter === 1) bucket.q1 = row.periodEnd;
    if (row.fiscalQuarter === 2) bucket.q2 = row.periodEnd;
    if (row.fiscalQuarter === 3) bucket.q3 = row.periodEnd;
    if (row.fiscalQuarter === 4) bucket.q4 = row.periodEnd;
    byFiscalYear.set(row.fiscalYear, bucket);
  }

  const subtractFlow = (annual: number, parts: number[]): number => annual - parts.reduce((sum, value) => sum + value, 0);
  const subtractNullableFlow = (annual: number | null, parts: Array<number | null>): number | null => {
    if (annual === null) return null;
    if (parts.some((value) => value === null)) return null;
    return annual - (parts[0] ?? 0) - (parts[1] ?? 0) - (parts[2] ?? 0);
  };

  for (const [fiscalYear, bucket] of byFiscalYear.entries()) {
    if (!bucket.q4) continue;
    const q4Income = incomeByPeriod.get(bucket.q4);
    if (!q4Income) continue;
    if (q4Income.formType !== "10-K") continue;
    if (!bucket.q1 || !bucket.q2 || !bucket.q3) {
      warnings.push(`Q4 normalization skipped for FY${fiscalYear} at ${q4Income.periodEnd}: missing Q1-Q3.`);
      continue;
    }

    const q1Income = incomeByPeriod.get(bucket.q1);
    const q2Income = incomeByPeriod.get(bucket.q2);
    const q3Income = incomeByPeriod.get(bucket.q3);
    const q4Cash = cashflowByPeriod.get(bucket.q4);
    const q1Cash = cashflowByPeriod.get(bucket.q1);
    const q2Cash = cashflowByPeriod.get(bucket.q2);
    const q3Cash = cashflowByPeriod.get(bucket.q3);
    if (!q1Income || !q2Income || !q3Income) {
      warnings.push(`Q4 normalization skipped for FY${fiscalYear} at ${q4Income.periodEnd}: missing income alignment.`);
      continue;
    }
    if (!q4Cash || !q1Cash || !q2Cash || !q3Cash) {
      warnings.push(`Q4 normalization skipped for FY${fiscalYear} at ${q4Income.periodEnd}: missing cashflow alignment.`);
      continue;
    }

    const revenue = subtractFlow(q4Income.revenue, [q1Income.revenue, q2Income.revenue, q3Income.revenue]);
    if (!Number.isFinite(revenue) || revenue <= 0) {
      warnings.push(`Q4 normalization skipped for FY${fiscalYear} at ${q4Income.periodEnd}: derived revenue invalid.`);
      continue;
    }

    q4Income.revenue = revenue;
    q4Income.costOfRevenue = subtractNullableFlow(q4Income.costOfRevenue, [q1Income.costOfRevenue, q2Income.costOfRevenue, q3Income.costOfRevenue]);
    q4Income.grossProfit = subtractNullableFlow(q4Income.grossProfit, [q1Income.grossProfit, q2Income.grossProfit, q3Income.grossProfit])
      ?? computeDifference(q4Income.revenue, q4Income.costOfRevenue);
    q4Income.researchDevelopment = subtractNullableFlow(q4Income.researchDevelopment, [q1Income.researchDevelopment, q2Income.researchDevelopment, q3Income.researchDevelopment]);
    q4Income.sellingGeneralAdmin = subtractNullableFlow(q4Income.sellingGeneralAdmin, [q1Income.sellingGeneralAdmin, q2Income.sellingGeneralAdmin, q3Income.sellingGeneralAdmin]);
    q4Income.depreciationAmortization = subtractNullableFlow(
      q4Income.depreciationAmortization,
      [q1Income.depreciationAmortization, q2Income.depreciationAmortization, q3Income.depreciationAmortization]
    );
    q4Income.stockBasedCompensation = subtractNullableFlow(
      q4Income.stockBasedCompensation,
      [q1Income.stockBasedCompensation, q2Income.stockBasedCompensation, q3Income.stockBasedCompensation]
    );
    q4Income.ebit = subtractFlow(q4Income.ebit, [q1Income.ebit, q2Income.ebit, q3Income.ebit]);
    q4Income.interestExpense = subtractNullableFlow(q4Income.interestExpense, [q1Income.interestExpense, q2Income.interestExpense, q3Income.interestExpense]);
    q4Income.interestIncome = subtractNullableFlow(q4Income.interestIncome, [q1Income.interestIncome, q2Income.interestIncome, q3Income.interestIncome]);
    q4Income.netInterestExpense = subtractNullable(q4Income.interestExpense, q4Income.interestIncome);
    q4Income.incomeBeforeTax = subtractNullableFlow(q4Income.incomeBeforeTax, [q1Income.incomeBeforeTax, q2Income.incomeBeforeTax, q3Income.incomeBeforeTax]);
    q4Income.incomeTaxExpense = subtractNullableFlow(q4Income.incomeTaxExpense, [q1Income.incomeTaxExpense, q2Income.incomeTaxExpense, q3Income.incomeTaxExpense]);
    q4Income.netIncome = subtractFlow(q4Income.netIncome, [q1Income.netIncome, q2Income.netIncome, q3Income.netIncome]);
    q4Income.grossMargin = safeDivide(q4Income.grossProfit, q4Income.revenue);
    q4Income.ebitda = q4Income.depreciationAmortization !== null ? q4Income.ebit + q4Income.depreciationAmortization : null;
    q4Income.ebitMargin = safeDivide(q4Income.ebit, q4Income.revenue);
    q4Income.ebitdaMargin = safeDivide(q4Income.ebitda, q4Income.revenue);
    q4Income.netMargin = safeDivide(q4Income.netIncome, q4Income.revenue);
    if (q4Income.incomeTaxExpense !== null && q4Income.incomeBeforeTax !== null && q4Income.incomeBeforeTax > 0) {
      const taxRate = q4Income.incomeTaxExpense / q4Income.incomeBeforeTax;
      q4Income.effectiveTaxRate = taxRate >= 0 && taxRate <= 0.5 ? taxRate : 0.21;
    }

    q4Cash.operatingCashFlow = subtractFlow(q4Cash.operatingCashFlow, [q1Cash.operatingCashFlow, q2Cash.operatingCashFlow, q3Cash.operatingCashFlow]);
    q4Cash.capex = subtractNullableFlow(q4Cash.capex, [q1Cash.capex, q2Cash.capex, q3Cash.capex]);
    q4Cash.acquisitions = subtractNullableFlow(q4Cash.acquisitions, [q1Cash.acquisitions, q2Cash.acquisitions, q3Cash.acquisitions]);
    q4Cash.purchasesOfInvestments = subtractNullableFlow(
      q4Cash.purchasesOfInvestments,
      [q1Cash.purchasesOfInvestments, q2Cash.purchasesOfInvestments, q3Cash.purchasesOfInvestments]
    );
    q4Cash.salesOfInvestments = subtractNullableFlow(
      q4Cash.salesOfInvestments,
      [q1Cash.salesOfInvestments, q2Cash.salesOfInvestments, q3Cash.salesOfInvestments]
    );
    q4Cash.investingCashFlow = subtractNullableFlow(q4Cash.investingCashFlow, [q1Cash.investingCashFlow, q2Cash.investingCashFlow, q3Cash.investingCashFlow]);
    q4Cash.debtIssuance = subtractNullableFlow(q4Cash.debtIssuance, [q1Cash.debtIssuance, q2Cash.debtIssuance, q3Cash.debtIssuance]);
    q4Cash.debtRepayment = subtractNullableFlow(q4Cash.debtRepayment, [q1Cash.debtRepayment, q2Cash.debtRepayment, q3Cash.debtRepayment]);
    q4Cash.shareIssuance = subtractNullableFlow(q4Cash.shareIssuance, [q1Cash.shareIssuance, q2Cash.shareIssuance, q3Cash.shareIssuance]);
    q4Cash.shareBuybacks = subtractNullableFlow(q4Cash.shareBuybacks, [q1Cash.shareBuybacks, q2Cash.shareBuybacks, q3Cash.shareBuybacks]);
    q4Cash.dividendsPaid = subtractNullableFlow(q4Cash.dividendsPaid, [q1Cash.dividendsPaid, q2Cash.dividendsPaid, q3Cash.dividendsPaid]);
    q4Cash.financingCashFlow = subtractNullableFlow(q4Cash.financingCashFlow, [q1Cash.financingCashFlow, q2Cash.financingCashFlow, q3Cash.financingCashFlow]);
    q4Cash.freeCashFlow = q4Cash.capex !== null ? q4Cash.operatingCashFlow - Math.abs(q4Cash.capex) : null;
    q4Cash.fcfMargin = safeDivide(q4Cash.freeCashFlow, q4Income.revenue);
    q4Cash.fcfConversion = safeDivide(q4Cash.freeCashFlow, q4Income.netIncome);

    warnings.push(`Q4 normalized from annual 10-K totals for FY${fiscalYear} at ${q4Income.periodEnd}.`);
  }

  return { income, cashflow };
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE + PERSISTENCE (Neon Postgres)
// ─────────────────────────────────────────────────────────────────────────────

async function ensureTables(): Promise<void> {
  if (tablesEnsured || !env.POSTGRES_URL) return;

  await sql`
    CREATE TABLE IF NOT EXISTS eldar_company_profile (
      ticker TEXT PRIMARY KEY,
      cik TEXT NOT NULL,
      name TEXT NOT NULL,
      exchange TEXT,
      sector TEXT,
      sic TEXT,
      fiscal_year_end TEXT,
      description TEXT,
      pipeline_version TEXT NOT NULL,
      payload JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS eldar_financials (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      period_end TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      fiscal_quarter INTEGER NOT NULL,
      form_type TEXT,
      filed_date TEXT,
      revenue NUMERIC(20,2),
      ebit NUMERIC(20,2),
      ebitda NUMERIC(20,2),
      net_income NUMERIC(20,2),
      operating_cash_flow NUMERIC(20,2),
      free_cash_flow NUMERIC(20,2),
      total_assets NUMERIC(20,2),
      total_debt NUMERIC(20,2),
      cash NUMERIC(20,2),
      stockholders_equity NUMERIC(20,2),
      shares_outstanding NUMERIC(20,0),
      enterprise_value NUMERIC(20,2),
      ev_to_ebitda NUMERIC(10,4),
      pe_ratio NUMERIC(10,4),
      fcf_yield NUMERIC(10,6),
      roic NUMERIC(10,6),
      roe NUMERIC(10,6),
      roa NUMERIC(10,6),
      payload JSONB NOT NULL,
      pipeline_version TEXT NOT NULL,
      confidence TEXT NOT NULL,
      imputed_fields JSONB DEFAULT '[]'::jsonb,
      warnings JSONB DEFAULT '[]'::jsonb,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      restated BOOLEAN NOT NULL DEFAULT FALSE
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_ticker_period ON eldar_financials(ticker, period_end)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_ticker ON eldar_financials(ticker)`;

  await sql`
    CREATE TABLE IF NOT EXISTS eldar_price_history (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      open NUMERIC(12,4),
      high NUMERIC(12,4),
      low NUMERIC(12,4),
      close NUMERIC(12,4),
      adj_close NUMERIC(12,4),
      volume NUMERIC(15,0)
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_ticker_date ON eldar_price_history(ticker, date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prices_ticker ON eldar_price_history(ticker)`;

  await sql`
    CREATE TABLE IF NOT EXISTS eldar_financials_cache (
      ticker TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      pipeline_version TEXT NOT NULL,
      fundamentals_refreshed_at TIMESTAMPTZ NOT NULL,
      prices_refreshed_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  tablesEnsured = true;
}

async function loadCacheEnvelope(ticker: string): Promise<CacheEnvelope | null> {
  if (!env.POSTGRES_URL) {
    return loadLocalCacheEnvelope(ticker);
  }
  let rows: Array<{
    payload: CompanyFinancials;
    pipeline_version: string;
    fundamentals_refreshed_at: string;
    prices_refreshed_at: string;
  }> = [];
  try {
    await ensureTables();
    const result = await sql<{
      payload: CompanyFinancials;
      pipeline_version: string;
      fundamentals_refreshed_at: string;
      prices_refreshed_at: string;
    }>`
      SELECT payload, pipeline_version, fundamentals_refreshed_at::text, prices_refreshed_at::text
      FROM eldar_financials_cache
      WHERE ticker = ${ticker}
      LIMIT 1
    `;
    rows = result.rows;
  } catch {
    return loadLocalCacheEnvelope(ticker);
  }
  if (rows.length === 0) return loadLocalCacheEnvelope(ticker);
  const row = rows[0];
  if (row.pipeline_version !== PIPELINE_VERSION) return loadLocalCacheEnvelope(ticker);

  const fundamentalsRefreshedAt = Date.parse(row.fundamentals_refreshed_at);
  const pricesRefreshedAt = Date.parse(row.prices_refreshed_at);
  if (!Number.isFinite(fundamentalsRefreshedAt) || !Number.isFinite(pricesRefreshedAt)) {
    return loadLocalCacheEnvelope(ticker);
  }

  const nowMs = Date.now();
  return {
    payload: row.payload,
    fundamentalsRefreshedAtMs: fundamentalsRefreshedAt,
    pricesRefreshedAtMs: pricesRefreshedAt,
    isFundamentalsFresh: nowMs - fundamentalsRefreshedAt <= FUNDAMENTALS_MAX_STALE_MS,
    isPricesFresh: nowMs - pricesRefreshedAt <= PRICES_MAX_STALE_MS
  };
}

function getLocalFinancialsCachePath(ticker: string): string {
  return path.join(LOCAL_FINANCIALS_CACHE_DIR, `${normalizeTicker(ticker).toUpperCase()}.json`);
}

function toCacheEnvelope(
  payload: CompanyFinancials,
  fundamentalsRefreshedAtIso: string,
  pricesRefreshedAtIso: string
): CacheEnvelope | null {
  const fundamentalsRefreshedAt = Date.parse(fundamentalsRefreshedAtIso);
  const pricesRefreshedAt = Date.parse(pricesRefreshedAtIso);
  if (!Number.isFinite(fundamentalsRefreshedAt) || !Number.isFinite(pricesRefreshedAt)) return null;
  const nowMs = Date.now();
  return {
    payload,
    fundamentalsRefreshedAtMs: fundamentalsRefreshedAt,
    pricesRefreshedAtMs: pricesRefreshedAt,
    isFundamentalsFresh: nowMs - fundamentalsRefreshedAt <= FUNDAMENTALS_MAX_STALE_MS,
    isPricesFresh: nowMs - pricesRefreshedAt <= PRICES_MAX_STALE_MS
  };
}

async function loadLocalCacheEnvelope(ticker: string): Promise<CacheEnvelope | null> {
  try {
    const cachePath = getLocalFinancialsCachePath(ticker);
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as LocalFinancialsCacheEntry;
    if (!parsed || parsed.pipelineVersion !== PIPELINE_VERSION) return null;
    return toCacheEnvelope(parsed.payload, parsed.fundamentalsRefreshedAt, parsed.pricesRefreshedAt);
  } catch {
    return null;
  }
}

async function saveLocalCache(
  financials: CompanyFinancials,
  fundamentalsRefreshedAtIso: string,
  pricesRefreshedAtIso: string
): Promise<void> {
  try {
    await fs.mkdir(LOCAL_FINANCIALS_CACHE_DIR, { recursive: true });
    const cachePath = getLocalFinancialsCachePath(financials.ticker);
    const payload: LocalFinancialsCacheEntry = {
      payload: financials,
      pipelineVersion: financials.pipelineVersion,
      fundamentalsRefreshedAt: fundamentalsRefreshedAtIso,
      pricesRefreshedAt: pricesRefreshedAtIso,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(cachePath, JSON.stringify(payload), "utf8");
  } catch {
    // Best-effort local cache only; ignore disk write errors.
  }
}

async function saveToCache(financials: CompanyFinancials, restated: boolean, quote: ProviderQuoteRow | null): Promise<void> {
  const nowIso = new Date().toISOString();
  const pricesRefreshedAt = (() => {
    const ts = trimOrNull(quote?.timestamp);
    if (!ts) return nowIso;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso;
  })();

  const latestRatio = financials.ratios.at(-1);
  const latestEvToEbitda = latestRatio?.evToEbitda ?? null;
  if (latestEvToEbitda !== null && latestEvToEbitda > 80) {
    financials.warnings.push(`Unusual EV/EBITDA ${latestEvToEbitda.toFixed(1)}x in latest quarter.`);
  }
  const quarterRows = financials.income.map((inc, index) => ({
    income: inc,
    balance: financials.balance[index],
    cashflow: financials.cashflow[index],
    ratios: financials.ratios[index]
  }));

  if (!env.POSTGRES_URL) {
    await saveLocalCache(financials, nowIso, pricesRefreshedAt);
    return;
  }

  await ensureTables();

  await sql`
    INSERT INTO eldar_company_profile (
      ticker, cik, name, exchange, sector, sic, fiscal_year_end, description, pipeline_version, payload, updated_at
    )
    VALUES (
      ${financials.profile.ticker},
      ${financials.profile.cik},
      ${financials.profile.name},
      ${financials.profile.exchange},
      ${financials.profile.sector},
      ${financials.profile.sic},
      ${financials.profile.fiscalYearEnd},
      ${financials.profile.description},
      ${financials.pipelineVersion},
      ${JSON.stringify(financials.profile)}::jsonb,
      NOW()
    )
    ON CONFLICT (ticker)
    DO UPDATE SET
      cik = EXCLUDED.cik,
      name = EXCLUDED.name,
      exchange = EXCLUDED.exchange,
      sector = EXCLUDED.sector,
      sic = EXCLUDED.sic,
      fiscal_year_end = EXCLUDED.fiscal_year_end,
      description = EXCLUDED.description,
      pipeline_version = EXCLUDED.pipeline_version,
      payload = EXCLUDED.payload,
      updated_at = NOW()
  `;

  await sql`DELETE FROM eldar_financials WHERE ticker = ${financials.ticker}`;
  await sql`DELETE FROM eldar_price_history WHERE ticker = ${financials.ticker}`;

  const quarterInsertRows = quarterRows
    .filter((row) => row.balance && row.cashflow && row.ratios)
    .map((row) => ({
      id: `${financials.ticker}-${row.income.periodEnd}`,
      ticker: financials.ticker,
      period_end: row.income.periodEnd,
      fiscal_year: row.income.fiscalYear,
      fiscal_quarter: row.income.fiscalQuarter,
      form_type: row.income.formType,
      filed_date: row.income.filedDate,
      revenue: row.income.revenue,
      ebit: row.income.ebit,
      ebitda: row.income.ebitda,
      net_income: row.income.netIncome,
      operating_cash_flow: row.cashflow?.operatingCashFlow ?? null,
      free_cash_flow: row.cashflow?.freeCashFlow ?? null,
      total_assets: row.balance?.totalAssets ?? null,
      total_debt: row.balance?.totalDebt ?? null,
      cash: row.balance?.cash ?? null,
      stockholders_equity: row.balance?.stockholdersEquity ?? null,
      shares_outstanding: row.balance?.sharesOutstanding ?? null,
      enterprise_value: row.ratios?.enterpriseValue ?? null,
      ev_to_ebitda: row.ratios?.evToEbitda ?? null,
      pe_ratio: row.ratios?.peRatio ?? null,
      fcf_yield: row.ratios?.fcfYield ?? null,
      roic: row.ratios?.roic ?? null,
      roe: row.ratios?.roe ?? null,
      roa: row.ratios?.roa ?? null,
      payload: row,
      pipeline_version: financials.pipelineVersion,
      confidence: financials.confidence,
      imputed_fields: financials.imputedFields,
      warnings: financials.warnings,
      restated: restated
    }));

  if (quarterInsertRows.length > 0) {
    await sql`
      INSERT INTO eldar_financials (
        id, ticker, period_end, fiscal_year, fiscal_quarter, form_type, filed_date,
        revenue, ebit, ebitda, net_income, operating_cash_flow, free_cash_flow,
        total_assets, total_debt, cash, stockholders_equity, shares_outstanding,
        enterprise_value, ev_to_ebitda, pe_ratio, fcf_yield, roic, roe, roa,
        payload, pipeline_version, confidence, imputed_fields, warnings, computed_at, restated
      )
      SELECT
        q.id::text,
        q.ticker::text,
        q.period_end::text,
        q.fiscal_year::int,
        q.fiscal_quarter::int,
        q.form_type::text,
        q.filed_date::text,
        q.revenue::numeric,
        q.ebit::numeric,
        q.ebitda::numeric,
        q.net_income::numeric,
        q.operating_cash_flow::numeric,
        q.free_cash_flow::numeric,
        q.total_assets::numeric,
        q.total_debt::numeric,
        q.cash::numeric,
        q.stockholders_equity::numeric,
        q.shares_outstanding::numeric,
        q.enterprise_value::numeric,
        q.ev_to_ebitda::numeric,
        q.pe_ratio::numeric,
        q.fcf_yield::numeric,
        q.roic::numeric,
        q.roe::numeric,
        q.roa::numeric,
        q.payload::jsonb,
        q.pipeline_version::text,
        q.confidence::text,
        q.imputed_fields::jsonb,
        q.warnings::jsonb,
        NOW(),
        q.restated::boolean
      FROM jsonb_to_recordset(${JSON.stringify(quarterInsertRows)}::jsonb) AS q(
        id text,
        ticker text,
        period_end text,
        fiscal_year int,
        fiscal_quarter int,
        form_type text,
        filed_date text,
        revenue numeric,
        ebit numeric,
        ebitda numeric,
        net_income numeric,
        operating_cash_flow numeric,
        free_cash_flow numeric,
        total_assets numeric,
        total_debt numeric,
        cash numeric,
        stockholders_equity numeric,
        shares_outstanding numeric,
        enterprise_value numeric,
        ev_to_ebitda numeric,
        pe_ratio numeric,
        fcf_yield numeric,
        roic numeric,
        roe numeric,
        roa numeric,
        payload jsonb,
        pipeline_version text,
        confidence text,
        imputed_fields jsonb,
        warnings jsonb,
        restated boolean
      )
    `;
  }

  const priceInsertRows = financials.prices.daily.map((row) => ({
    id: `${financials.ticker}-${row.date}`,
    ticker: financials.ticker,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    adj_close: row.adjClose,
    volume: row.volume
  }));

  if (priceInsertRows.length > 0) {
    await sql`
      INSERT INTO eldar_price_history (id, ticker, date, open, high, low, close, adj_close, volume)
      SELECT
        p.id::text,
        p.ticker::text,
        p.date::text,
        p.open::numeric,
        p.high::numeric,
        p.low::numeric,
        p.close::numeric,
        p.adj_close::numeric,
        p.volume::numeric
      FROM jsonb_to_recordset(${JSON.stringify(priceInsertRows)}::jsonb) AS p(
        id text,
        ticker text,
        date text,
        open numeric,
        high numeric,
        low numeric,
        close numeric,
        adj_close numeric,
        volume numeric
      )
    `;
  }

  await sql`
    INSERT INTO eldar_financials_cache (
      ticker, payload, pipeline_version, fundamentals_refreshed_at, prices_refreshed_at, updated_at
    )
    VALUES (
      ${financials.ticker},
      ${JSON.stringify(financials)}::jsonb,
      ${financials.pipelineVersion},
      ${nowIso}::timestamptz,
      ${pricesRefreshedAt}::timestamptz,
      NOW()
    )
    ON CONFLICT (ticker)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      pipeline_version = EXCLUDED.pipeline_version,
      fundamentals_refreshed_at = EXCLUDED.fundamentals_refreshed_at,
      prices_refreshed_at = EXCLUDED.prices_refreshed_at,
      updated_at = NOW()
  `;

  await saveLocalCache(financials, nowIso, pricesRefreshedAt);
}
