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
