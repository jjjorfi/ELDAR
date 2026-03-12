// ─── Shared domain types ─────────────────────────────────────────────────────
// v8: added rs52Week, zScore52Week, priceZScore20d, dtc to technical block
//     added insiderBuyRatio to new insider block
//     added roicTrend to snapshot root
//     added entryAlert and squeezeRisk to AnalysisResult
//     hasData and dataCompleteness retained from v7

export type RatingLabel =
  | "STRONG_BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG_SELL";

export type PeDisplayBasis = "NTM" | "TTM" | "UNAVAILABLE";
export type EpsGrowthDisplayBasis = "YOY" | "QOQ" | "FORWARD_DELTA" | "UNAVAILABLE";

export interface FactorResult {
  category:
    | "Fundamental"
    | "Valuation"
    | "Technical"
    | "Sentiment"
    | "Macro";
  factor: string;
  /** Sector-adjusted weight. All weights sum to 10 post-normalisation. */
  weight: number;
  bullishPoints: number;
  bearishPoints: number;
  points: number;
  signal: "BULLISH" | "NEUTRAL" | "BEARISH";
  ruleMatched: string;
  metricValue: string;
  /**
   * true  = real data present; factor included in denominator.
   * false = missing data; factor excluded from denominator (score renormalised).
   */
  hasData: boolean;
}

export interface AnalysisResult {
  modelVersion: string;
  symbol: string;
  companyName: string;
  sector: string;
  currency: string;
  currentPrice: number;
  marketCap: number | null;
  /** Composite score 0–10, renormalised over available factors. */
  score: number;
  rating: RatingLabel;
  ratingNote: string;
  factors: FactorResult[];
  /**
   * Fraction of factor weight with real data (0.0–1.0).
   * Scores below 0.65 completeness are capped at BUY/SELL (never STRONG_BUY/SELL).
   */
  dataCompleteness: number;
  /**
   * 20-day Price Z-Score surfaced for UI entry-timing alerts.
   * NOT included in composite score.
   * null when price/vol data unavailable.
   * > +2.0 = "extended — await pullback"
   * < -2.0 = "deeply oversold — potential entry"
   */
  entryAlert: {
    priceZScore20d: number | null;
    signal: "EXTENDED" | "OVERSOLD" | "NEUTRAL" | "UNAVAILABLE";
    note: string;
  };
  /**
   * Short-squeeze risk gate result (DTC check).
   * squeezeRisk=true means DTC > 10; STRONG_SELL was capped to SELL.
   */
  squeezeRisk: boolean;
  /**
   * Raw snapshot fundamentals carried through to the UI so Key Fundamentals
   * does not depend on scored factor strings for display values.
   */
  fundamentals: {
    forwardPE: number | null;
    trailingPE: number | null;
    peBasis: PeDisplayBasis;
    revenueGrowth: number | null;
    earningsQuarterlyGrowth: number | null;
    epsGrowthBasis: EpsGrowthDisplayBasis;
    fcfYield: number | null;
    evEbitda: number | null;
    ffoYield: number | null;
  };
  generatedAt: string;
}

// ─── Market snapshot ──────────────────────────────────────────────────────────

export interface MarketSnapshot {
  symbol: string;
  companyName: string;
  sector: string | null;
  currency: string;
  currentPrice: number;
  marketCap: number | null;

  // ── Fundamental ─────────────────────────────────────────────────────────
  earningsQuarterlyGrowth: number | null;
  forwardEps: number | null;
  trailingEps: number | null;
  revenueGrowth: number | null;
  fcfYield: number | null;
  debtToEquity: number | null;
  forwardPE: number | null;
  forwardPEBasis: "NTM" | "TTM" | "UNKNOWN" | null;
  roic: number | null;
  /** ROIC current year minus ROIC prior year (e.g. +0.03 = +3pp improvement). */
  roicTrend: number | null;
  ffoYield: number | null;
  evEbitda: number | null;
  epsRevision30d: number | null;
  earningsGrowthBasis: "YOY" | "QOQ" | "UNKNOWN" | null;

  // ── Technical ───────────────────────────────────────────────────────────
  technical: {
    sma200: number | null;
    /**
     * 52-week Relative Strength ratio: stock total return / sector ETF total return.
     * > 1.0 = stock outperforming sector ETF over past 52 weeks.
     * Replaces RSI-14 in v8.
     */
    rs52Week: number | null;
    /**
     * 52-week Price Z-Score: (price − 52w MA) / 52w rolling σ.
     * Momentum-confirmatory signal (positive = bullish).
     * Separate from the 20-day entry gate.
     */
    zScore52Week: number | null;
    /**
     * 20-day Price Z-Score: (price − 20d MA) / 20d rolling σ.
     * NOT scored in composite. Used for entryAlert only.
     */
    priceZScore20d: number | null;
    rsi14: number | null; // retained for backward compatibility; not used in scoring
    /**
     * Days to Cover = short interest (shares) / average daily volume.
     * DTC > 10 triggers squeezeRisk gate; STRONG_SELL → SELL.
     */
    dtc: number | null;
  };

  // ── Options ──────────────────────────────────────────────────────────────
  options: {
    putCallRatio: number | null; // retained for compat; not scored in v8
    totalCallVolume: number | null;
    totalPutVolume: number | null;
  };

  // ── Insider ──────────────────────────────────────────────────────────────
  insider: {
    /**
     * Net insider buying over past 90 days as a fraction of float.
     * Positive = net buying; negative = net selling.
     * Replaces Put/Call Ratio in v8.
     * IC 0.04–0.06 at 12-month horizon (orthogonal to estRev).
     */
    netBuyRatio90d: number | null;
  };

  // ── Short interest ───────────────────────────────────────────────────────
  shortPercentOfFloat: number | null;

  // ── Macro ────────────────────────────────────────────────────────────────
  macro: {
    vixLevel: number | null;
    /**
     * Commodity regime flag for Energy and Materials sectors.
     * Computed externally: 12-month return of WTI (Energy) or
     * copper futures (Materials).
     * > +0.25  = commodity expansion  → use standard P90 benchmarks
     * < -0.25  = commodity contraction → double valuation tolerance (halve PE/EBITDA weights)
     * null     = unknown; standard benchmarks apply
     */
    commodityMomentum12m: number | null;
  };
}

export interface PersistedAnalysis extends AnalysisResult {
  id: string;
  createdAt: string;
}

export interface WatchlistItem {
  symbol: string;
  createdAt: string;
  latest?: PersistedAnalysis;
}

export interface Mag7ScoreCard {
  symbol: string;
  companyName: string;
  score: number;
  rating: RatingLabel;
  currentPrice: number;
  changePercent: number | null;
  updatedAt: string;
}
