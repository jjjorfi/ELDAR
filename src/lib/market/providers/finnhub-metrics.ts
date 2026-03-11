export interface FinnhubMetrics {
  forwardPE: number | null;
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  roe: number | null;
  roicTrend: number | null;
  debtToEquity: number | null;
  grossMargin: number | null;
  grossMarginTTM: number | null;
  profitMargin: number | null;
  marketCap: number | null;
  eps: number | null;
  forwardEps: number | null;
  trailingEps: number | null;
  epsEstimate: number | null;
  shortPercentOfFloat: number | null;
  freeCashflow: number | null;
  evEbitda: number | null;
  dtc: number | null;
  sharesOutstanding: number | null;
  avgDailyVolumeShares: number | null;
}

/**
 * Creates an empty Finnhub metrics object when payload is missing/invalid.
 *
 * @returns Null-initialized metrics shape.
 */
function emptyMetrics(): FinnhubMetrics {
  return {
    forwardPE: null,
    earningsGrowth: null,
    revenueGrowth: null,
    roe: null,
    roicTrend: null,
    debtToEquity: null,
    grossMargin: null,
    grossMarginTTM: null,
    profitMargin: null,
    marketCap: null,
    eps: null,
    forwardEps: null,
    trailingEps: null,
    epsEstimate: null,
    shortPercentOfFloat: null,
    freeCashflow: null,
    evEbitda: null,
    dtc: null,
    sharesOutstanding: null,
    avgDailyVolumeShares: null
  };
}

/**
 * Converts Finnhub percent-style metrics into decimal form.
 *
 * @param value Raw metric value.
 * @returns Decimal representation or null.
 */
function toDecimalPercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return value / 100;
}

/**
 * Normalizes share-count style fields that may be shipped in millions.
 *
 * @param value Raw metric value.
 * @param threshold Maximum value treated as "millions" scale.
 * @returns Absolute share count or null.
 */
function toAbsoluteShares(value: number | null, threshold: number): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value <= threshold ? value * 1_000_000 : value;
}

/**
 * Extracts normalized metrics from Finnhub stock/metric payload.
 *
 * @param payload Raw stock/metric API payload.
 * @returns Normalized metrics used by the scoring pipeline.
 */
export function extractFinnhubMetrics(payload: unknown): FinnhubMetrics {
  if (typeof payload !== "object" || payload === null || !("metric" in payload)) {
    return emptyMetrics();
  }

  const metric = (payload as { metric?: Record<string, unknown> }).metric;
  if (!metric) {
    return emptyMetrics();
  }

  const m = metric;
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = m[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  };

  const epsEstimateRaw = pick("epsEstimateTTM", "epsEstimateNext", "epsEstimateCurrentYear", "epsEstimateNextYear");
  const shortRaw = pick("shortPercentOfFloat", "shortPercent", "shortInterestPercent", "shortInterest");
  const roicCurrentRaw = pick("roicTTM", "roicRfy", "roicAnnual", "returnOnInvestedCapitalTTM");
  const roicPriorRaw = pick("roicPriorYear", "roicPrevYear", "roicRfy-1", "returnOnInvestedCapitalRfy");
  const roeCurrentRaw = pick("roeTTM", "roeRfy", "roeAnnual");
  const roePriorRaw = pick("roeRfy", "roePriorYear", "roePrevYear");
  const sharesOutstandingRaw = pick("shareOutstanding", "sharesOutstanding", "totalSharesOutstanding");
  const sharesOutstanding = toAbsoluteShares(sharesOutstandingRaw, 500_000);
  const marketCap = typeof m.marketCapitalization === "number" ? m.marketCapitalization * 1_000_000 : null;

  // Prefer direct FCF metrics first; derive from EV/FCF as fallback.
  const directFreeCashflow = pick("freeCashFlowTTM", "freeCashFlowAnnual", "freeCashFlowPerShareTTM");

  // Calculate Free Cash Flow from EV and EV/FCF ratio when direct FCF is not provided.
  const enterpriseValue = typeof m.enterpriseValue === "number" ? m.enterpriseValue * 1_000_000 : null;
  const evToFcf = typeof m["currentEv/freeCashFlowTTM"] === "number" ? m["currentEv/freeCashFlowTTM"] : null;
  const derivedFreeCashflow =
    enterpriseValue !== null && evToFcf !== null && evToFcf > 0 ? enterpriseValue / evToFcf : null;

  // Fallback for financials where direct free-cash-flow fields are often absent.
  const cashFlowPerShare = pick("cashFlowPerShareTTM", "cashFlowPerShareAnnual");
  const derivedFromCashFlowPerShare =
    cashFlowPerShare !== null && sharesOutstanding !== null ? cashFlowPerShare * sharesOutstanding : null;

  const pfcfRatio = pick("pfcfShareTTM", "pfcfShareAnnual", "pfcfTTM");
  const derivedFromPfcfRatio =
    marketCap !== null && pfcfRatio !== null && pfcfRatio > 0 ? marketCap / pfcfRatio : null;

  const freeCashflow =
    directFreeCashflow !== null
      ? (directFreeCashflow > 10_000 ? directFreeCashflow : directFreeCashflow * 1_000_000)
      : derivedFreeCashflow ?? derivedFromCashFlowPerShare ?? derivedFromPfcfRatio;

  const shortPercentOfFloat =
    shortRaw === null
      ? null
      : shortRaw > 1
        ? shortRaw / 100
        : shortRaw;

  const roicCurrent = toDecimalPercent(roicCurrentRaw);
  const roicPrior = toDecimalPercent(roicPriorRaw);
  const roeCurrent = toDecimalPercent(roeCurrentRaw);
  const roePrior = toDecimalPercent(roePriorRaw);

  // Prefer ROIC delta when available; fall back to ROE delta as a conservative proxy.
  const roicTrend =
    roicCurrent !== null && roicPrior !== null
      ? roicCurrent - roicPrior
      : roeCurrent !== null && roePrior !== null
        ? roeCurrent - roePrior
        : null;

  const avgDailyVolumeRaw = pick(
    "10DayAverageTradingVolume",
    "3MonthAverageTradingVolume",
    "averageDailyVolume10Day",
    "averageVolume",
    "avgVolume"
  );

  const avgDailyVolumeShares = toAbsoluteShares(avgDailyVolumeRaw, 2_000);

  return {
    forwardPE: typeof m.forwardPE === "number" ? m.forwardPE : null,
    earningsGrowth: toDecimalPercent(pick("epsGrowthTTMYoy", "epsGrowth5Y")),
    revenueGrowth: toDecimalPercent(pick("revenueGrowthTTMYoy", "revenueGrowth5Y")),
    roe: toDecimalPercent(pick("roeTTM", "roeRfy")),
    roicTrend,
    debtToEquity:
      typeof m["totalDebt/totalEquityQuarterly"] === "number"
        ? m["totalDebt/totalEquityQuarterly"]
        : null,
    grossMargin: toDecimalPercent(pick("grossMarginTTM")),
    grossMarginTTM: toDecimalPercent(pick("grossMarginAnnual")),
    profitMargin: toDecimalPercent(pick("netProfitMarginTTM")),
    marketCap,
    eps: typeof m.epsAnnual === "number" ? m.epsAnnual : null,
    forwardEps: typeof m.epsTTM === "number" ? m.epsTTM : null,
    trailingEps: typeof m.epsAnnual === "number" ? m.epsAnnual : null,
    epsEstimate: epsEstimateRaw,
    shortPercentOfFloat,
    freeCashflow,
    evEbitda: pick("evEbitdaTTM", "enterpriseValueOverEBITDA", "evToEbitda", "evEbitda"),
    dtc: pick("daysToCover", "shortInterestDaysToCover", "shortRatio", "shortInterestDTC"),
    sharesOutstanding,
    avgDailyVolumeShares
  };
}
