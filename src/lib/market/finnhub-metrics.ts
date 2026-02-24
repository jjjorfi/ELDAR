export interface FinnhubMetrics {
  forwardPE: number | null;
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  roe: number | null;
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
    freeCashflow: null
  };
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

  // Prefer direct FCF metrics first; derive from EV/FCF as fallback.
  const directFreeCashflow = pick("freeCashFlowTTM", "freeCashFlowAnnual", "freeCashFlowPerShareTTM");

  // Calculate Free Cash Flow from EV and EV/FCF ratio when direct FCF is not provided.
  const enterpriseValue = typeof m.enterpriseValue === "number" ? m.enterpriseValue * 1_000_000 : null;
  const evToFcf = typeof m["currentEv/freeCashFlowTTM"] === "number" ? m["currentEv/freeCashFlowTTM"] : null;
  const derivedFreeCashflow =
    enterpriseValue !== null && evToFcf !== null && evToFcf > 0 ? enterpriseValue / evToFcf : null;
  const freeCashflow =
    directFreeCashflow !== null
      ? (directFreeCashflow > 10_000 ? directFreeCashflow : directFreeCashflow * 1_000_000)
      : derivedFreeCashflow;

  const shortPercentOfFloat =
    shortRaw === null
      ? null
      : shortRaw > 1
        ? shortRaw / 100
        : shortRaw;

  return {
    forwardPE: typeof m.forwardPE === "number" ? m.forwardPE : null,
    earningsGrowth: typeof m.epsGrowthTTMYoy === "number" ? m.epsGrowthTTMYoy / 100 : null,
    revenueGrowth: typeof m.revenueGrowthTTMYoy === "number" ? m.revenueGrowthTTMYoy / 100 : null,
    roe: typeof m.roeTTM === "number" ? m.roeTTM / 100 : null,
    debtToEquity:
      typeof m["totalDebt/totalEquityQuarterly"] === "number"
        ? m["totalDebt/totalEquityQuarterly"]
        : null,
    grossMargin: typeof m.grossMarginTTM === "number" ? m.grossMarginTTM / 100 : null,
    grossMarginTTM: typeof m.grossMarginAnnual === "number" ? m.grossMarginAnnual / 100 : null,
    profitMargin: typeof m.netProfitMarginTTM === "number" ? m.netProfitMarginTTM / 100 : null,
    marketCap: typeof m.marketCapitalization === "number" ? m.marketCapitalization * 1_000_000 : null,
    eps: typeof m.epsAnnual === "number" ? m.epsAnnual : null,
    forwardEps: typeof m.epsTTM === "number" ? m.epsTTM : null,
    trailingEps: typeof m.epsAnnual === "number" ? m.epsAnnual : null,
    epsEstimate: epsEstimateRaw,
    shortPercentOfFloat,
    freeCashflow
  };
}
