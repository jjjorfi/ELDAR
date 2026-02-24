# ELDAR Engine Backup (2026-02-18)

This file captures the exact scoring engine and threshold configuration currently in use.

## File: /Users/s.bahij/Documents/ELDAR SaaS/src/lib/scoring/engine.ts
```ts
import { ratingNote, toRating } from "@/lib/rating";
import { getSectorConfig, getSectorWeights, type SectorConfig, type SectorWeights } from "@/lib/scoring/sector-config";
import { SCORING_MODEL_VERSION } from "@/lib/scoring/version";
import type { AnalysisResult, FactorResult, MarketSnapshot } from "@/lib/types";

const RELATIVE_MULTIPLIERS = {
  p90: 1.0,
  p75: 0.8,
  p50: 0.5,
  p25: 0.2,
  floor: 0.05
} as const;

type RelativeTier = "P90" | "P75" | "P50" | "P25" | "FLOOR";

interface RelativeBands {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

interface RelativeScore {
  points: number;
  tier: RelativeTier;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function factor(
  category: FactorResult["category"],
  name: string,
  weight: number,
  bullishPoints: number,
  bearishPoints: number,
  points: number,
  signal: FactorResult["signal"],
  ruleMatched: string,
  metricValue: string
): FactorResult {
  return {
    category,
    factor: name,
    weight: round2(weight),
    bullishPoints: round2(bullishPoints),
    bearishPoints: round2(bearishPoints),
    points: round2(points),
    signal,
    ruleMatched,
    metricValue
  };
}

function signalFromPoints(points: number, maxPoints: number): FactorResult["signal"] {
  if (points >= maxPoints * 0.66) return "BULLISH";
  if (points >= maxPoints * 0.33) return "NEUTRAL";
  return "BEARISH";
}

function buildPositiveBands(p90: number): RelativeBands {
  const safe = Math.max(p90, 0.000001);

  return {
    p25: safe * 0.4,
    p50: safe * 0.65,
    p75: safe * 0.85,
    p90: safe
  };
}

function buildInverseBands(p90: number): RelativeBands {
  const safe = Math.max(p90, 0.000001);

  return {
    p25: safe * 0.5,
    p50: safe * 0.7,
    p75: safe * 0.85,
    p90: safe
  };
}

function scoreRelativePositive(value: number, bands: RelativeBands, weight: number): RelativeScore {
  if (value >= bands.p90) return { points: weight * RELATIVE_MULTIPLIERS.p90, tier: "P90" };
  if (value >= bands.p75) return { points: weight * RELATIVE_MULTIPLIERS.p75, tier: "P75" };
  if (value >= bands.p50) return { points: weight * RELATIVE_MULTIPLIERS.p50, tier: "P50" };
  if (value >= bands.p25) return { points: weight * RELATIVE_MULTIPLIERS.p25, tier: "P25" };
  return { points: weight * RELATIVE_MULTIPLIERS.floor, tier: "FLOOR" };
}

function scoreRelativeInverse(value: number, bands: RelativeBands, weight: number): RelativeScore {
  if (value <= bands.p25) return { points: weight * RELATIVE_MULTIPLIERS.p90, tier: "P90" };
  if (value <= bands.p50) return { points: weight * RELATIVE_MULTIPLIERS.p75, tier: "P75" };
  if (value <= bands.p75) return { points: weight * RELATIVE_MULTIPLIERS.p50, tier: "P50" };
  if (value <= bands.p90) return { points: weight * RELATIVE_MULTIPLIERS.p25, tier: "P25" };
  return { points: weight * RELATIVE_MULTIPLIERS.floor, tier: "FLOOR" };
}

function positiveRuleLabel(tier: RelativeTier): string {
  if (tier === "P90") return "Relative percentile >= P90";
  if (tier === "P75") return "Relative percentile P75-P90";
  if (tier === "P50") return "Relative percentile P50-P75";
  if (tier === "P25") return "Relative percentile P25-P50";
  return "Relative percentile < P25";
}

function inverseRuleLabel(tier: RelativeTier): string {
  if (tier === "P90") return "Relative percentile <= P25";
  if (tier === "P75") return "Relative percentile P25-P50";
  if (tier === "P50") return "Relative percentile P50-P75";
  if (tier === "P25") return "Relative percentile P75-P90";
  return "Relative percentile > P90";
}

function scoreTrend(pctAboveSma200: number, weight: number): number {
  if (pctAboveSma200 > 0.15) return weight;
  if (pctAboveSma200 > 0.1) return weight * 0.93;
  if (pctAboveSma200 > 0.05) return weight * 0.83;
  if (pctAboveSma200 > 0) return weight * 0.67;
  if (pctAboveSma200 > -0.05) return weight * 0.5;
  if (pctAboveSma200 > -0.1) return weight * 0.33;
  if (pctAboveSma200 > -0.15) return weight * 0.2;
  return weight * 0.1;
}

function scoreRsi(value: number, weight: number): number {
  if (value < 20) return weight;
  if (value < 25) return weight * 0.916;
  if (value < 30) return weight * 0.833;
  if (value < 40) return weight * 0.792;
  if (value < 50) return weight * 0.667;
  if (value < 60) return weight * 0.542;
  if (value < 70) return weight * 0.375;
  if (value < 80) return weight * 0.208;
  return weight * 0.083;
}

function scorePcr(ratio: number, weight: number): number {
  if (ratio < 0.5) return weight;
  if (ratio < 0.6) return weight * 0.9;
  if (ratio < 0.7) return weight * 0.8;
  if (ratio < 0.8) return weight * 0.7;
  if (ratio < 0.9) return weight * 0.6;
  if (ratio < 1.0) return weight * 0.5;
  if (ratio < 1.1) return weight * 0.4;
  if (ratio < 1.2) return weight * 0.3;
  return weight * 0.15;
}

function scoreShortInterest(pct: number, weight: number): number {
  if (pct < 0.01) return weight;
  if (pct < 0.02) return weight * 0.9375;
  if (pct < 0.03) return weight * 0.8125;
  if (pct < 0.04) return weight * 0.6875;
  if (pct < 0.05) return weight * 0.5625;
  if (pct < 0.06) return weight * 0.4375;
  if (pct < 0.07) return weight * 0.3125;
  if (pct < 0.08) return weight * 0.1875;
  return weight * 0.0625;
}

function scoreVix(level: number, weight: number): number {
  if (level < 10) return weight;
  if (level < 12) return weight * 0.9286;
  if (level < 15) return weight * 0.7857;
  if (level < 18) return weight * 0.6429;
  if (level < 20) return weight * 0.5;
  if (level < 25) return weight * 0.3571;
  if (level < 30) return weight * 0.2143;
  return weight * 0.0714;
}

function epsFactor(snapshot: MarketSnapshot, config: SectorConfig, weights: SectorWeights): FactorResult {
  const growth =
    snapshot.earningsQuarterlyGrowth ??
    (snapshot.forwardEps !== null && snapshot.trailingEps !== null && snapshot.trailingEps !== 0
      ? (snapshot.forwardEps - snapshot.trailingEps) / Math.abs(snapshot.trailingEps)
      : null);

  if (growth === null) {
    return factor(
      "Fundamental",
      "EPS Growth",
      weights.eps,
      weights.eps,
      0,
      0,
      "NEUTRAL",
      "No EPS growth data",
      "EPS Growth N/A"
    );
  }

  const scored = scoreRelativePositive(growth, buildPositiveBands(config.epsP90), weights.eps);

  return factor(
    "Fundamental",
    "EPS Growth",
    weights.eps,
    weights.eps,
    0,
    scored.points,
    signalFromPoints(scored.points, weights.eps),
    `${positiveRuleLabel(scored.tier)} (sector P90 ${(config.epsP90 * 100).toFixed(1)}%)`,
    `EPS Growth ${(growth * 100).toFixed(1)}%`
  );
}

function trendFactor(snapshot: MarketSnapshot, weights: SectorWeights): FactorResult {
  const sma200 = snapshot.technical.sma200;
  if (sma200 === null || sma200 === 0) {
    return factor("Technical", "Price > 200SMA", weights.trend, weights.trend, 0, 0, "NEUTRAL", "No trend data", "200SMA N/A");
  }

  const pctAbove = (snapshot.currentPrice - sma200) / sma200;
  const points = scoreTrend(pctAbove, weights.trend);
  return factor(
    "Technical",
    "Price > 200SMA",
    weights.trend,
    weights.trend,
    0,
    points,
    signalFromPoints(points, weights.trend),
    "Universal trend model",
    `Price ${(pctAbove * 100).toFixed(1)}% vs 200SMA`
  );
}

function rsiFactor(snapshot: MarketSnapshot, weights: SectorWeights): FactorResult {
  const value = snapshot.technical.rsi14;
  if (value === null) {
    return factor("Technical", "RSI", weights.rsi, weights.rsi, 0, 0, "NEUTRAL", "No RSI data", "RSI N/A");
  }

  const points = scoreRsi(value, weights.rsi);
  return factor(
    "Technical",
    "RSI",
    weights.rsi,
    weights.rsi,
    0,
    points,
    signalFromPoints(points, weights.rsi),
    "Universal RSI model",
    `RSI ${value.toFixed(1)}`
  );
}

function pcrFactor(snapshot: MarketSnapshot, weights: SectorWeights): FactorResult {
  const ratio = snapshot.options.putCallRatio;
  const callVolume = snapshot.options.totalCallVolume;
  const putVolume = snapshot.options.totalPutVolume;

  const metricParts: string[] = [ratio === null ? "PCR N/A" : `PCR ${ratio.toFixed(2)}`];
  if (callVolume !== null && putVolume !== null) {
    metricParts.push(`Calls ${Math.round(callVolume).toLocaleString("en-US")}`);
    metricParts.push(`Puts ${Math.round(putVolume).toLocaleString("en-US")}`);
  }

  if (ratio === null) {
    return factor("Options", "Put/Call Ratio", weights.pcr, weights.pcr, 0, 0, "NEUTRAL", "No options flow data", metricParts.join(" | "));
  }

  const points = scorePcr(ratio, weights.pcr);
  return factor(
    "Options",
    "Put/Call Ratio",
    weights.pcr,
    weights.pcr,
    0,
    points,
    signalFromPoints(points, weights.pcr),
    "Universal PCR model",
    metricParts.join(" | ")
  );
}

function fcfFactor(snapshot: MarketSnapshot, config: SectorConfig, weights: SectorWeights): FactorResult {
  const yieldPct = snapshot.fcfYield;
  if (yieldPct === null) {
    return factor("Fundamental", "FCF Yield", weights.fcf, weights.fcf, 0, 0, "NEUTRAL", "No FCF data", "FCF Yield N/A");
  }

  const scored = scoreRelativePositive(yieldPct, buildPositiveBands(config.fcfP90), weights.fcf);

  return factor(
    "Fundamental",
    "FCF Yield",
    weights.fcf,
    weights.fcf,
    0,
    scored.points,
    signalFromPoints(scored.points, weights.fcf),
    `${positiveRuleLabel(scored.tier)} (sector P90 ${(config.fcfP90 * 100).toFixed(1)}%)`,
    `FCF Yield ${(yieldPct * 100).toFixed(1)}%`
  );
}

function shortInterestFactor(snapshot: MarketSnapshot, weights: SectorWeights): FactorResult {
  const shortPct = snapshot.shortPercentOfFloat;
  if (shortPct === null) {
    return factor("Sentiment", "Short Interest", weights.short, weights.short, 0, 0, "NEUTRAL", "No short-interest data", "Short Interest N/A");
  }

  const points = scoreShortInterest(shortPct, weights.short);
  return factor(
    "Sentiment",
    "Short Interest",
    weights.short,
    weights.short,
    0,
    points,
    signalFromPoints(points, weights.short),
    "Universal short-interest model",
    `Short Interest ${(shortPct * 100).toFixed(1)}%`
  );
}

function vixFactor(snapshot: MarketSnapshot, weights: SectorWeights): FactorResult {
  const vix = snapshot.macro.vixLevel;
  if (vix === null) {
    return factor("Macro", "VIX", weights.vix, weights.vix, 0, 0, "NEUTRAL", "No VIX data", "VIX N/A");
  }

  const points = scoreVix(vix, weights.vix);
  return factor(
    "Macro",
    "VIX",
    weights.vix,
    weights.vix,
    0,
    points,
    signalFromPoints(points, weights.vix),
    "Universal VIX model",
    `VIX ${vix.toFixed(1)}`
  );
}

function revenueFactor(snapshot: MarketSnapshot, config: SectorConfig, weights: SectorWeights): FactorResult {
  const growth = snapshot.revenueGrowth;
  if (growth === null) {
    return factor("Fundamental", "Revenue Growth", weights.rev, weights.rev, 0, 0, "NEUTRAL", "No revenue growth data", "Revenue Growth N/A");
  }

  const scored = scoreRelativePositive(growth, buildPositiveBands(config.revP90), weights.rev);

  return factor(
    "Fundamental",
    "Revenue Growth",
    weights.rev,
    weights.rev,
    0,
    scored.points,
    signalFromPoints(scored.points, weights.rev),
    `${positiveRuleLabel(scored.tier)} (sector P90 ${(config.revP90 * 100).toFixed(1)}%)`,
    `Revenue Growth ${(growth * 100).toFixed(1)}%`
  );
}

function peFactor(snapshot: MarketSnapshot, config: SectorConfig, weights: SectorWeights): FactorResult {
  const forwardPE = snapshot.forwardPE;
  if (forwardPE === null) {
    return factor("Valuation", "P/E vs Sector", weights.pe, weights.pe, 0, 0, "NEUTRAL", "No valuation data", "Forward P/E N/A");
  }

  const scored = scoreRelativeInverse(forwardPE, buildInverseBands(config.peP90), weights.pe);

  return factor(
    "Valuation",
    "P/E vs Sector",
    weights.pe,
    weights.pe,
    0,
    scored.points,
    signalFromPoints(scored.points, weights.pe),
    `${inverseRuleLabel(scored.tier)} (sector P90 ${config.peP90.toFixed(1)}x)`,
    `P/E ${forwardPE.toFixed(1)}x`
  );
}

function debtFactor(snapshot: MarketSnapshot, config: SectorConfig, weights: SectorWeights): FactorResult {
  const ratio = snapshot.debtToEquity;
  if (ratio === null) {
    return factor("Valuation", "Debt/Equity", weights.debt, weights.debt, 0, 0, "NEUTRAL", "No debt data", "Debt/Equity N/A");
  }

  const debtPct = ratio * 100;
  const scored = scoreRelativeInverse(debtPct, buildInverseBands(config.debtP90), weights.debt);

  return factor(
    "Valuation",
    "Debt/Equity",
    weights.debt,
    weights.debt,
    0,
    scored.points,
    signalFromPoints(scored.points, weights.debt),
    `${inverseRuleLabel(scored.tier)} (sector P90 ${config.debtP90.toFixed(0)}%)`,
    `Debt/Equity ${debtPct.toFixed(1)}%`
  );
}

export function scoreSnapshot(snapshot: MarketSnapshot): AnalysisResult {
  const { normalizedSector, config } = getSectorConfig(snapshot.sector);
  const weights = getSectorWeights(config);

  const factors: FactorResult[] = [
    epsFactor(snapshot, config, weights),
    trendFactor(snapshot, weights),
    rsiFactor(snapshot, weights),
    pcrFactor(snapshot, weights),
    fcfFactor(snapshot, config, weights),
    shortInterestFactor(snapshot, weights),
    vixFactor(snapshot, weights),
    revenueFactor(snapshot, config, weights),
    peFactor(snapshot, config, weights),
    debtFactor(snapshot, config, weights)
  ];

  const rawScore = factors.reduce((sum, f) => sum + f.points, 0);
  const score = round2(Math.max(0, Math.min(10, rawScore)));
  const rating = toRating(score);

  return {
    modelVersion: SCORING_MODEL_VERSION,
    symbol: snapshot.symbol,
    companyName: snapshot.companyName,
    sector: normalizedSector,
    currency: snapshot.currency,
    currentPrice: snapshot.currentPrice,
    marketCap: snapshot.marketCap,
    score,
    rating,
    ratingNote: ratingNote(score),
    factors,
    generatedAt: new Date().toISOString()
  };
}
```

## File: /Users/s.bahij/Documents/ELDAR SaaS/src/lib/scoring/sector-config.ts
```ts
export const GICS_SECTORS = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities"
] as const;

export type GicsSector = (typeof GICS_SECTORS)[number] | "Other";
type CanonicalGicsSector = Exclude<GicsSector, "Other">;

export interface GicsSectorMetadata {
  code: number;
  description: string;
}

export const GICS_SECTOR_METADATA: Record<CanonicalGicsSector, GicsSectorMetadata> = {
  "Information Technology": {
    code: 45,
    description: "Software, hardware, semiconductors."
  },
  Financials: {
    code: 40,
    description: "Banks, insurance, asset management."
  },
  "Health Care": {
    code: 35,
    description: "Pharma, biotech, medical devices."
  },
  "Consumer Discretionary": {
    code: 25,
    description: "Non-essentials: luxury goods, autos, broad retail."
  },
  "Communication Services": {
    code: 50,
    description: "Media, entertainment, social media, internet content."
  },
  Industrials: {
    code: 20,
    description: "Aerospace, defense, machinery, airlines, transportation."
  },
  "Consumer Staples": {
    code: 30,
    description: "Food, beverages, household products."
  },
  Energy: {
    code: 10,
    description: "Oil, gas, and consumable fuels."
  },
  Utilities: {
    code: 55,
    description: "Electric, gas, and water utilities."
  },
  "Real Estate": {
    code: 60,
    description: "REITs and real estate management."
  },
  Materials: {
    code: 15,
    description: "Chemicals, construction materials, containers and packaging."
  }
};

const GICS_CODE_TO_SECTOR: Record<string, CanonicalGicsSector> = {
  "45": "Information Technology",
  "40": "Financials",
  "35": "Health Care",
  "25": "Consumer Discretionary",
  "50": "Communication Services",
  "20": "Industrials",
  "30": "Consumer Staples",
  "10": "Energy",
  "55": "Utilities",
  "60": "Real Estate",
  "15": "Materials"
};

export interface SectorConfig {
  debtP90: number;
  fcfP90: number;
  epsP90: number;
  peP90: number;
  revP90: number;
  debtWeight: number;
  fcfWeight: number;
  revWeight: number;
}

export interface SectorWeights {
  eps: number;
  trend: number;
  rsi: number;
  pcr: number;
  fcf: number;
  short: number;
  vix: number;
  rev: number;
  pe: number;
  debt: number;
}

export const BASE_WEIGHTS: SectorWeights = {
  eps: 2.0,
  trend: 1.5,
  rsi: 1.2,
  pcr: 1.0,
  fcf: 1.0,
  short: 0.8,
  vix: 0.7,
  rev: 0.6,
  pe: 0.6,
  debt: 0.5
};

export const DEFAULT_CONFIG: SectorConfig = {
  debtP90: 90.0,
  fcfP90: 0.03,
  epsP90: 0.12,
  peP90: 24.0,
  revP90: 0.1,
  debtWeight: 1.0,
  fcfWeight: 1.0,
  revWeight: 1.0
};

const SECTOR_CONFIG: Partial<Record<(typeof GICS_SECTORS)[number], Partial<SectorConfig>>> = {
  "Communication Services": {
    debtP90: 90.0,
    fcfP90: 0.03,
    epsP90: 0.22,
    peP90: 28.0,
    revP90: 0.14
  },
  "Consumer Discretionary": {
    debtP90: 80.0,
    fcfP90: 0.025,
    epsP90: 0.18,
    peP90: 26.0,
    revP90: 0.16
  },
  "Consumer Staples": {
    debtP90: 100.0,
    fcfP90: 0.028,
    epsP90: 0.09,
    peP90: 24.0,
    revP90: 0.06,
    fcfWeight: 1.6
  },
  Energy: {
    debtP90: 120.0,
    fcfP90: 0.04,
    epsP90: 0.15,
    peP90: 14.0,
    revP90: 0.12,
    revWeight: 1.5
  },
  Financials: {
    debtP90: 150.0,
    fcfP90: 0.015,
    epsP90: 0.1,
    peP90: 13.0,
    revP90: 0.07,
    debtWeight: 1.8,
    fcfWeight: 0.7
  },
  "Health Care": {
    debtP90: 75.0,
    fcfP90: 0.022,
    epsP90: 0.16,
    peP90: 30.0,
    revP90: 0.12
  },
  Industrials: {
    debtP90: 90.0,
    fcfP90: 0.025,
    epsP90: 0.12,
    peP90: 21.0,
    revP90: 0.09
  },
  "Information Technology": {
    debtP90: 50.0,
    fcfP90: 0.035,
    epsP90: 0.25,
    peP90: 36.0,
    revP90: 0.22,
    debtWeight: 0.5,
    fcfWeight: 1.5
  },
  Materials: {
    debtP90: 110.0,
    fcfP90: 0.028,
    epsP90: 0.11,
    peP90: 19.0,
    revP90: 0.08
  },
  "Real Estate": {
    debtP90: 130.0,
    fcfP90: 0.04,
    epsP90: 0.08,
    peP90: 23.0,
    revP90: 0.07
  },
  Utilities: {
    debtP90: 140.0,
    fcfP90: 0.045,
    epsP90: 0.07,
    peP90: 19.0,
    revP90: 0.05
  }
};

const UNKNOWN_SECTOR_VALUES = new Set([
  "",
  "-",
  "na",
  "n/a",
  "none",
  "null",
  "unknown",
  "unclassified",
  "other"
]);

const DIRECT_SECTOR_ALIASES: Record<string, GicsSector> = {
  "communication services": "Communication Services",
  communicationservices: "Communication Services",
  communications: "Communication Services",
  "consumer discretionary": "Consumer Discretionary",
  consumerdiscretionary: "Consumer Discretionary",
  "consumer cyclical": "Consumer Discretionary",
  consumercyclical: "Consumer Discretionary",
  "consumer staples": "Consumer Staples",
  consumerstaples: "Consumer Staples",
  "consumer defensive": "Consumer Staples",
  consumerdefensive: "Consumer Staples",
  energy: "Energy",
  financial: "Financials",
  financials: "Financials",
  "financial services": "Financials",
  financialservices: "Financials",
  "health care": "Health Care",
  healthcare: "Health Care",
  health: "Health Care",
  industrials: "Industrials",
  industrial: "Industrials",
  "information technology": "Information Technology",
  informationtechnology: "Information Technology",
  technology: "Information Technology",
  tech: "Information Technology",
  materials: "Materials",
  "basic materials": "Materials",
  basicmaterials: "Materials",
  "communication service": "Communication Services",
  communicationservice: "Communication Services",
  "financial service": "Financials",
  financialservice: "Financials",
  "real estate": "Real Estate",
  realestate: "Real Estate",
  utilities: "Utilities",
  utility: "Utilities"
};

// Validated Yahoo Finance industry labels -> GICS sectors.
const YAHOO_INDUSTRY_TO_GICS: Record<string, GicsSector> = {
  "semiconductors": "Information Technology",
  "semiconductor equipment": "Information Technology",
  "semiconductor materials": "Information Technology",
  "software - infrastructure": "Information Technology",
  "software infrastructure": "Information Technology",
  "software - application": "Information Technology",
  "software application": "Information Technology",
  "entertainment": "Communication Services",
  "broadcasting": "Communication Services",
  "movies & entertainment": "Communication Services",
  "movies entertainment": "Communication Services",
  "internet content & information": "Communication Services",
  "internet content information": "Communication Services",
  "advertising agencies": "Communication Services",
  "banks - diversified": "Financials",
  "banks diversified": "Financials",
  "asset management": "Financials",
  "insurance - property & casualty": "Financials",
  "insurance property casualty": "Financials",
  "grocery stores": "Consumer Staples",
  "household & personal products": "Consumer Staples",
  "household personal products": "Consumer Staples"
};

// Yahoo-specific industry regex rules validated against common provider variants.
const YAHOO_INDUSTRY_PATTERNS: Array<{ sector: GicsSector; pattern: RegExp }> = [
  { sector: "Information Technology", pattern: /semi(?:conductor|conductors?)/i },
  { sector: "Communication Services", pattern: /entert(?:ain|ainment)/i },
  { sector: "Communication Services", pattern: /broadcas|tv|cable|radio/i },
  { sector: "Information Technology", pattern: /soft(?:ware|ware -)/i },
  { sector: "Financials", pattern: /banks?[- ]/i }
];

const INDUSTRY_PATTERNS: Array<{ sector: GicsSector; pattern: RegExp }> = [
  { sector: "Information Technology", pattern: /\b(semiconductor|software|computer|hardware|electronics?|it services|cloud|cybersecurity|data processing)\b/ },
  { sector: "Communication Services", pattern: /\b(telecom|wireless|broadcast|media|social media|advertising|entertainment|streaming|interactive media|content)\b/ },
  { sector: "Consumer Staples", pattern: /\b(grocery|food|beverage|household|consumer defensive|packaged|tobacco|discount store|hypermarket|supermarket|staples)\b/ },
  { sector: "Consumer Discretionary", pattern: /\b(consumer cyclical|non essentials|non-essentials|luxury|retail|auto|automobile|apparel|restaurant|leisure|travel|lodging|home improvement|internet retail|specialty retail|e commerce|e-commerce)\b/ },
  { sector: "Financials", pattern: /\b(bank|banking|insurance|asset management|capital markets|financial|credit|mortgage|brokerage|payment|fintech)\b/ },
  { sector: "Health Care", pattern: /\b(health care|healthcare|pharma|pharmaceutical|biotech|medical|diagnostic|therapeutic|managed care|drug)\b/ },
  { sector: "Energy", pattern: /\b(energy|oil|gas|consumable fuels?|exploration|drilling|pipeline|refining|midstream|upstream)\b/ },
  { sector: "Utilities", pattern: /\b(utility|utilities|regulated electric|electric utility|water utility|gas utility|power generation)\b/ },
  { sector: "Industrials", pattern: /\b(industrial|aerospace|defense|machinery|rail|transport|logistics|construction|engineering|airline|freight)\b/ },
  { sector: "Materials", pattern: /\b(materials|basic materials|chemical|chemicals|mining|metals|steel|aluminum|copper|paper|containers?|packaging|fertilizer|construction materials)\b/ },
  { sector: "Real Estate", pattern: /\b(real estate|reit|property|commercial real estate|residential real estate)\b/ }
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function directSectorMatch(raw: string): GicsSector | null {
  const normalized = raw.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  return (
    DIRECT_SECTOR_ALIASES[normalized] ??
    DIRECT_SECTOR_ALIASES[compact] ??
    GICS_CODE_TO_SECTOR[normalized] ??
    GICS_CODE_TO_SECTOR[compact] ??
    null
  );
}

function yahooIndustryMatch(raw: string, normalizedText: string): GicsSector | null {
  const rawLower = raw.trim().toLowerCase();

  return (
    YAHOO_INDUSTRY_TO_GICS[rawLower] ??
    YAHOO_INDUSTRY_TO_GICS[normalizedText] ??
    null
  );
}

export function normalizeSectorName(rawSector: string | null | undefined): GicsSector {
  if (!rawSector) {
    return "Other";
  }

  const normalizedText = normalizeText(rawSector);
  if (!normalizedText || UNKNOWN_SECTOR_VALUES.has(normalizedText)) {
    return "Other";
  }

  const direct = directSectorMatch(rawSector);
  if (direct) {
    return direct;
  }

  const yahooExact = yahooIndustryMatch(rawSector, normalizedText);
  if (yahooExact) {
    return yahooExact;
  }

  for (const { sector, pattern } of [...YAHOO_INDUSTRY_PATTERNS, ...INDUSTRY_PATTERNS]) {
    if (pattern.test(normalizedText)) {
      return sector;
    }
  }

  return "Other";
}

export function resolveSectorFromCandidates(candidates: Array<string | null | undefined>): GicsSector {
  for (const candidate of candidates) {
    const normalized = normalizeSectorName(candidate);
    if (normalized !== "Other") {
      return normalized;
    }
  }

  return "Other";
}

export function getSectorConfig(sector: string | null | undefined): { normalizedSector: GicsSector; config: SectorConfig } {
  const normalizedSector = normalizeSectorName(sector);

  if (normalizedSector === "Other") {
    return {
      normalizedSector,
      config: { ...DEFAULT_CONFIG }
    };
  }

  return {
    normalizedSector,
    config: {
      ...DEFAULT_CONFIG,
      ...SECTOR_CONFIG[normalizedSector]
    }
  };
}

export function getSectorWeights(config: SectorConfig): SectorWeights {
  return {
    ...BASE_WEIGHTS,
    debt: BASE_WEIGHTS.debt * config.debtWeight,
    fcf: BASE_WEIGHTS.fcf * config.fcfWeight,
    rev: BASE_WEIGHTS.rev * config.revWeight
  };
}

export function getGicsSectorMetadata(sector: string | null | undefined): {
  normalizedSector: GicsSector;
  code: number | null;
  description: string;
} {
  const normalizedSector = normalizeSectorName(sector);

  if (normalizedSector === "Other") {
    return {
      normalizedSector,
      code: null,
      description: "Unclassified sector."
    };
  }

  const metadata = GICS_SECTOR_METADATA[normalizedSector];
  return {
    normalizedSector,
    code: metadata.code,
    description: metadata.description
  };
}
```

## File: /Users/s.bahij/Documents/ELDAR SaaS/src/lib/rating.ts
```ts
import type { RatingLabel } from "@/lib/types";

export const RATING_BANDS: Record<
  RatingLabel,
  {
    min: number;
    max: number;
    label: string;
    explanation: string;
    emoji: string;
    color: "#B91C1C" | "#EF4444" | "#6B7280" | "#10B981" | "#059669";
  }
> = {
  STRONG_BUY: {
    min: 8.1,
    max: 10,
    label: "STRONGLY BULLISH",
    explanation: "Strong upside momentum with broad confirmation",
    emoji: "🐂",
    color: "#059669"
  },
  BUY: {
    min: 6.1,
    max: 8.0,
    label: "BULLISH",
    explanation: "Bullish setup with favorable conditions",
    emoji: "🟢",
    color: "#10B981"
  },
  HOLD: {
    min: 4.1,
    max: 6.0,
    label: "NEUTRAL",
    explanation: "Balanced setup, monitor for a directional break",
    emoji: "⚪",
    color: "#6B7280"
  },
  SELL: {
    min: 2.1,
    max: 4.0,
    label: "BEARISH",
    explanation: "Weak setup - reduce exposure",
    emoji: "🔴",
    color: "#EF4444"
  },
  STRONG_SELL: {
    min: 0,
    max: 2.0,
    label: "STRONGLY BEARISH",
    explanation: "High downside risk - avoid or hedge",
    emoji: "🐻",
    color: "#B91C1C"
  }
};

export function toRating(score: number): RatingLabel {
  if (score > 8.0) return "STRONG_BUY";
  if (score > 6.0) return "BUY";
  if (score > 4.0) return "HOLD";
  if (score > 2.0) return "SELL";
  return "STRONG_SELL";
}

export function ratingNote(score: number): string {
  const rating = toRating(score);
  return RATING_BANDS[rating].explanation;
}
```

## File: /Users/s.bahij/Documents/ELDAR SaaS/src/lib/scoring/version.ts
```ts
export const SCORING_MODEL_VERSION = "2026-02-17-v5-relative-sector-percentiles";
```
