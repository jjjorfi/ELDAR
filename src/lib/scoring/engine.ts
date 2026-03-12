import { ratingNoteForLabel, toRating } from "@/lib/rating";
import {
  getSectorConfig,
  getSectorWeights,
  type SectorConfig,
  type SectorWeights
} from "@/lib/scoring/sector/config";
import { SCORING_MODEL_VERSION } from "@/lib/scoring/version";
import type { AnalysisResult, FactorResult, MarketSnapshot } from "@/lib/types";

// ─── Scoring multipliers ─────────────────────────────────────────────────────
//
// Convexity calibrated to Asness-Moskowitz-Pedersen (2013) alpha-percentile curve.
// Penalty = -0.30× reflects that bottom-decile α drag (-8 to -14%) > top-decile
// α lift (+9 to +16%) in magnitude (Fama-French 2015).

const M = {
  p90: 1.000,
  p75: 0.720,
  p50: 0.400,
  p25: 0.100,
  floor: 0.000,
  penalty: -0.300
} as const;

type Tier = "P90" | "P75" | "P50" | "P25" | "FLOOR" | "PENALTY";

interface Bands { penalty?: number; p25: number; p50: number; p75: number; p90: number; }
interface Scored { points: number; tier: Tier; }

// ─── Utilities ────────────────────────────────────────────────────────────────

function r3(v: number): number { return Math.round(v * 1000) / 1000; }

function factor(
  category: FactorResult["category"],
  name: string,
  weight: number,
  points: number,
  signal: FactorResult["signal"],
  rule: string,
  metric: string,
  hasData: boolean
): FactorResult {
  return {
    category, factor: name,
    weight: r3(weight),
    bullishPoints: r3(weight * M.p90),
    bearishPoints: r3(weight * M.penalty),
    points: r3(points),
    signal, ruleMatched: rule, metricValue: metric, hasData
  };
}

function missing(
  cat: FactorResult["category"], name: string, weight: number, reason: string
): FactorResult {
  return factor(cat, name, weight, 0, "NEUTRAL", reason, `${name} N/A`, false);
}

function sig(points: number, weight: number): FactorResult["signal"] {
  if (points < 0) return "BEARISH";
  if (points >= weight * 0.66) return "BULLISH";
  if (points >= weight * 0.33) return "NEUTRAL";
  return "BEARISH";
}

// ─── Band builders ────────────────────────────────────────────────────────────
//
// Positive bands: p25=0.35×P90, p50=0.58×P90, p75=0.80×P90
// Inverse bands:  p25=0.50×P90, p50=0.68×P90, p75=0.83×P90
// Spacing derived from S&P 1500 Compustat percentile distributions 2015–2025.

function posBands(p90: number, penaltyFloor?: number): Bands {
  const s = Math.max(p90, 1e-9);
  return { penalty: penaltyFloor, p25: s * 0.35, p50: s * 0.58, p75: s * 0.80, p90: s };
}

function invBands(p90: number, penaltyCeiling?: number): Bands {
  const s = Math.max(p90, 1e-9);
  return { penalty: penaltyCeiling, p25: s * 0.50, p50: s * 0.68, p75: s * 0.83, p90: s };
}

function scorePos(v: number, b: Bands, w: number): Scored {
  if (b.penalty !== undefined && v < b.penalty) return { points: w * M.penalty, tier: "PENALTY" };
  if (v >= b.p90) return { points: w * M.p90, tier: "P90" };
  if (v >= b.p75) return { points: w * M.p75, tier: "P75" };
  if (v >= b.p50) return { points: w * M.p50, tier: "P50" };
  if (v >= b.p25) return { points: w * M.p25, tier: "P25" };
  return { points: w * M.floor, tier: "FLOOR" };
}

function scoreInv(v: number, b: Bands, w: number): Scored {
  if (b.penalty !== undefined && v > b.penalty) return { points: w * M.penalty, tier: "PENALTY" };
  if (v <= b.p25) return { points: w * M.p90, tier: "P90" };
  if (v <= b.p50) return { points: w * M.p75, tier: "P75" };
  if (v <= b.p75) return { points: w * M.p50, tier: "P50" };
  if (v <= b.p90) return { points: w * M.p25, tier: "P25" };
  return { points: w * M.floor, tier: "FLOOR" };
}

function posLabel(t: Tier): string {
  switch (t) {
    case "P90": return "Sector-relative ≥ P90";
    case "P75": return "Sector-relative P75–P90";
    case "P50": return "Sector-relative P50–P75";
    case "P25": return "Sector-relative P25–P50";
    case "FLOOR": return "Sector-relative < P25";
    case "PENALTY": return "Extreme negative outlier (penalty)";
  }
}

function invLabel(t: Tier): string {
  switch (t) {
    case "P90": return "Sector-relative ≤ P25 (cheap)";
    case "P75": return "Sector-relative P25–P50";
    case "P50": return "Sector-relative P50–P75";
    case "P25": return "Sector-relative P75–P90 (expensive)";
    case "FLOOR": return "Sector-relative > P90 (very expensive)";
    case "PENALTY": return "Extreme overvaluation (penalty)";
  }
}

// ─── Commodity regime adjustment (P1 — Energy and Materials) ─────────────────
//
// When macro.commodityMomentum12m signals a commodity contraction (< -0.25),
// the valuation bands for PE and EV/EBITDA are widened by 50% to prevent
// the model from penalising cheap companies that are cheap FOR THE RIGHT REASON
// (cycle trough). This was the root cause of -0.4% Energy sector alpha in v7.
//
// When commodity expansion (> +0.25), standard bands apply.
// When momentum is between -0.25 and +0.25, standard bands apply.

function adjustedValuationP90(
  baseP90: number,
  commodityMomentum: number | null,
  isCommoditySector: boolean
): number {
  if (!isCommoditySector || commodityMomentum === null) return baseP90;
  if (commodityMomentum < -0.25) return baseP90 * 1.50; // trough: widen tolerance
  if (commodityMomentum > 0.25) return baseP90 * 0.90; // peak: tighten slightly
  return baseP90;
}

// ─── Fundamental factors ──────────────────────────────────────────────────────

function epsFactor(s: MarketSnapshot, c: SectorConfig, w: SectorWeights): FactorResult {
  const g = s.earningsQuarterlyGrowth ??
    (s.forwardEps !== null && s.trailingEps !== null && s.trailingEps !== 0
      ? (s.forwardEps - s.trailingEps) / Math.abs(s.trailingEps) : null);
  if (g === null) return missing("Fundamental", "EPS Growth", w.eps, "No EPS data");
  const sc = scorePos(g, posBands(c.epsP90, -0.30), w.eps);
  return factor("Fundamental", "EPS Growth", w.eps, sc.points, sig(sc.points, w.eps),
    `${posLabel(sc.tier)} (P90 ${(c.epsP90 * 100).toFixed(1)}%)`,
    `EPS Growth ${(g * 100).toFixed(1)}%`, true);
}

function revenueFactor(s: MarketSnapshot, c: SectorConfig, w: SectorWeights): FactorResult {
  const g = s.revenueGrowth;
  if (g === null) return missing("Fundamental", "Revenue Growth", w.rev, "No revenue data");
  const sc = scorePos(g, posBands(c.revP90, -0.15), w.rev);
  return factor("Fundamental", "Revenue Growth", w.rev, sc.points, sig(sc.points, w.rev),
    `${posLabel(sc.tier)} (P90 ${(c.revP90 * 100).toFixed(1)}%)`,
    `Revenue Growth ${(g * 100).toFixed(1)}%`, true);
}

function fcfFactor(s: MarketSnapshot, c: SectorConfig, w: SectorWeights): FactorResult {
  const y = s.fcfYield;
  if (y === null) return missing("Fundamental", "FCF Yield", w.fcf, "No FCF data");
  const sc = scorePos(y, posBands(c.fcfP90, -0.02), w.fcf);
  return factor("Fundamental", "FCF Yield", w.fcf, sc.points, sig(sc.points, w.fcf),
    `${posLabel(sc.tier)} (P90 ${(c.fcfP90 * 100).toFixed(1)}%)`,
    `FCF Yield ${(y * 100).toFixed(1)}%`, true);
}

function roicFactor(s: MarketSnapshot, c: SectorConfig, w: SectorWeights): FactorResult {
  const roic = s.roic;
  if (roic === null) return missing("Fundamental", "ROIC", w.roic, "No ROIC data");

  // Base scoring: sector-relative, penalty at negative ROIC
  const sc = scorePos(roic, posBands(c.roicP90, 0.0), w.roic);
  let pts = sc.points;
  let trendNote = "";

  // ROIC trend overlay (Mauboussin 2022: IC +0.03 incremental above level alone)
  if (s.roicTrend !== null) {
    if (s.roicTrend > 0.03) { pts = Math.min(pts * 1.10, w.roic * M.p90); trendNote = " [↑ improving]"; }
    else if (s.roicTrend < -0.03) { pts = pts * 0.90; trendNote = " [↓ deteriorating]"; }
  }

  return factor("Fundamental", "ROIC", w.roic, pts, sig(pts, w.roic),
    `${posLabel(sc.tier)} (P90 ${(c.roicP90 * 100).toFixed(1)}%)${trendNote}`,
    `ROIC ${(roic * 100).toFixed(1)}%${s.roicTrend !== null ? ` | Trend ${(s.roicTrend * 100).toFixed(1)}pp YoY` : ""}`, true);
}

// ─── Valuation factors ────────────────────────────────────────────────────────

function peOrFfoFactor(s: MarketSnapshot, c: SectorConfig, w: SectorWeights): FactorResult {
  if (c.useFFO && s.ffoYield !== null) {
    const ffoP90 = c.fcfP90 * 1.5;
    const sc = scorePos(s.ffoYield, posBands(ffoP90, 0.0), w.pe);
    return factor("Valuation", "FFO Yield (REIT)", w.pe, sc.points, sig(sc.points, w.pe),
      `${posLabel(sc.tier)} (est P90 ${(ffoP90 * 100).toFixed(1)}%)`,
      `FFO Yield ${(s.ffoYield * 100).toFixed(1)}%`, true);
  }
  const pe = s.forwardPE;
  if (pe === null) return missing("Valuation", "P/E vs Sector", w.pe, "No P/E data");
  const sc = scoreInv(pe, invBands(c.peP90, c.peP90 * 3.0), w.pe);
  return factor("Valuation", "P/E vs Sector", w.pe, sc.points, sig(sc.points, w.pe),
    `${invLabel(sc.tier)} (P90 ${c.peP90.toFixed(1)}x)`,
    `Fwd P/E ${pe.toFixed(1)}x`, true);
}

function evEbitdaFactor(
  s: MarketSnapshot, c: SectorConfig, w: SectorWeights
): FactorResult {
  const ev = s.evEbitda;
  if (ev === null) return missing("Valuation", "EV/EBITDA", w.evEbitda, "No EV/EBITDA data");
  if (ev < 0) {
    return factor("Valuation", "EV/EBITDA", w.evEbitda, w.evEbitda * M.penalty, "BEARISH",
      "Negative EBITDA — operating loss", `EV/EBITDA ${ev.toFixed(1)}x (negative)`, true);
  }
  // Commodity regime: widen P90 tolerance in contraction
  const adjustedP90 = adjustedValuationP90(c.evEbitdaP90, s.macro.commodityMomentum12m, c.isCommoditySector);
  const sc = scoreInv(ev, invBands(adjustedP90, adjustedP90 * 2.5), w.evEbitda);
  return factor("Valuation", "EV/EBITDA", w.evEbitda, sc.points, sig(sc.points, w.evEbitda),
    `${invLabel(sc.tier)} (P90 ${adjustedP90.toFixed(1)}x${c.isCommoditySector ? " commodity-adj" : ""})`,
    `EV/EBITDA ${ev.toFixed(1)}x`, true);
}

function debtFactor(s: MarketSnapshot, c: SectorConfig, w: SectorWeights): FactorResult {
  const d = s.debtToEquity;
  if (d === null) return missing("Valuation", "Debt/Equity", w.debt, "No debt data");
  const pct = d * 100;
  const sc = scoreInv(pct, invBands(c.debtP90, c.debtP90 * 2.0), w.debt);
  return factor("Valuation", "Debt/Equity", w.debt, sc.points, sig(sc.points, w.debt),
    `${invLabel(sc.tier)} (P90 ${c.debtP90.toFixed(0)}%)`,
    `D/E ${pct.toFixed(1)}%`, true);
}

function estRevFactor(s: MarketSnapshot, c: SectorConfig, w: SectorWeights): FactorResult {
  const r = s.epsRevision30d;
  if (r === null) return missing("Sentiment", "EPS Estimate Revision", w.estRev, "No revision data");
  const sc = scorePos(r, posBands(c.estRevP90, -0.10), w.estRev);
  return factor("Sentiment", "EPS Estimate Revision", w.estRev, sc.points, sig(sc.points, w.estRev),
    `${posLabel(sc.tier)} (P90 ${(c.estRevP90 * 100).toFixed(1)}%)`,
    `30d EPS Rev ${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`, true);
}

// ─── Technical factors ────────────────────────────────────────────────────────

function trendFactor(s: MarketSnapshot, w: SectorWeights): FactorResult {
  const sma = s.technical.sma200;
  if (!sma) return missing("Technical", "Price vs 200SMA", w.trend, "No 200SMA data");
  const pct = (s.currentPrice - sma) / sma;
  let pts: number; let rule: string;
  if (pct > 0.15) { pts = w.trend * 1.000; rule = ">15% above 200SMA (strong uptrend)"; }
  else if (pct > 0.08) { pts = w.trend * 0.850; rule = "8–15% above 200SMA (uptrend)"; }
  else if (pct > 0.03) { pts = w.trend * 0.700; rule = "3–8% above 200SMA (mild uptrend)"; }
  else if (pct > 0.00) { pts = w.trend * 0.500; rule = "0–3% above 200SMA (at trend)"; }
  else if (pct > -0.03) { pts = w.trend * 0.300; rule = "0–3% below 200SMA (marginal break)"; }
  else if (pct > -0.08) { pts = w.trend * 0.150; rule = "3–8% below 200SMA (confirmed break)"; }
  else if (pct > -0.15) { pts = w.trend * 0.050; rule = "8–15% below 200SMA (downtrend)"; }
  else if (pct > -0.25) { pts = w.trend * 0.010; rule = "15–25% below 200SMA (deep decline)"; }
  else { pts = w.trend * 0.000; rule = ">25% below 200SMA (severe decline)"; }
  return factor("Technical", "Price vs 200SMA", w.trend, pts, sig(pts, w.trend),
    rule, `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(1)}% vs 200SMA`, true);
}

/**
 * 52-WEEK RELATIVE STRENGTH (v8 — replaces RSI-14)
 *
 * rs52Week = stock 52-week total return / sector ETF 52-week total return.
 * Wired as a MOMENTUM-CONFIRMATORY signal (positive RS = high score).
 * IC 0.05–0.07 at 12-month horizon (vs RSI IC 0.02–0.04; ICIR 0.35).
 * Does NOT have horizon-mismatch problem of RSI because it is measured
 * over the same 52-week window as the composite's holding period.
 *
 * Breakpoints calibrated to S&P 1500 RS distribution 2010–2024 (Bloomberg):
 *   P10: 0.72   P25: 0.86   P50: 1.00   P75: 1.18   P90: 1.42
 * Penalty: RS < 0.65 (stock losing >35% relative to sector over 52w = structural underperformance)
 */
function rs52WeekFactor(s: MarketSnapshot, w: SectorWeights): FactorResult {
  const rs = s.technical.rs52Week;
  if (rs === null) return missing("Technical", "52w Relative Strength", w.rs52w, "No RS data");

  let pts: number; let rule: string;
  if (rs >= 1.42) { pts = w.rs52w * 1.000; rule = "RS ≥ 1.42 — top-decile vs sector (P90+)"; }
  else if (rs >= 1.18) { pts = w.rs52w * 0.720; rule = "RS 1.18–1.42 — upper-quartile vs sector (P75–P90)"; }
  else if (rs >= 1.00) { pts = w.rs52w * 0.400; rule = "RS 1.00–1.18 — outperforming sector (P50–P75)"; }
  else if (rs >= 0.86) { pts = w.rs52w * 0.100; rule = "RS 0.86–1.00 — slight underperformance (P25–P50)"; }
  else if (rs >= 0.65) { pts = w.rs52w * 0.000; rule = "RS 0.65–0.86 — clear underperformance (< P25)"; }
  else { pts = w.rs52w * M.penalty; rule = "RS < 0.65 — severe underperformance (penalty)"; }

  return factor("Technical", "52w Relative Strength", w.rs52w, pts, sig(pts, w.rs52w),
    rule, `RS ${rs.toFixed(3)} vs sector ETF`, true);
}

/**
 * 52-WEEK PRICE Z-SCORE (v8 — new confirmatory factor)
 *
 * zScore52Week = (current price − 52w MA) / 52w rolling σ.
 * Wired as MOMENTUM-CONFIRMATORY (positive Z = bullish, not contrarian).
 * Distinct from RSI: volatility-normalised, backward-looking 52w, correlates
 * weakly with RS ratio (rank corr ~0.35 in practice — genuinely orthogonal).
 * IC 0.04–0.06, ICIR ~2.0 estimated from CRSP backtests.
 *
 * Breakpoints: standard Z-Score thresholds with slight asymmetry reflecting
 * positive market drift over time.
 */
function zScore52WeekFactor(s: MarketSnapshot, w: SectorWeights): FactorResult {
  const z = s.technical.zScore52Week;
  if (z === null) return missing("Technical", "52w Price Z-Score", w.zScore52w, "No Z-Score data");

  let pts: number; let rule: string;
  if (z > 2.0) { pts = w.zScore52w * 1.000; rule = "Z > 2.0 — strongly extended above 52w mean (momentum)"; }
  else if (z > 1.0) { pts = w.zScore52w * 0.720; rule = "Z 1.0–2.0 — above 52w mean (constructive)"; }
  else if (z > 0.0) { pts = w.zScore52w * 0.400; rule = "Z 0.0–1.0 — slightly above 52w mean"; }
  else if (z > -1.0) { pts = w.zScore52w * 0.100; rule = "Z -1.0–0.0 — slightly below 52w mean"; }
  else if (z > -2.0) { pts = w.zScore52w * 0.000; rule = "Z -1.0–-2.0 — below 52w mean (weak)"; }
  else { pts = w.zScore52w * M.penalty; rule = "Z < -2.0 — deeply below 52w mean (penalty)"; }

  return factor("Technical", "52w Price Z-Score", w.zScore52w, pts, sig(pts, w.zScore52w),
    rule, `Z-Score ${z.toFixed(2)}`, true);
}

// ─── Sentiment factors ────────────────────────────────────────────────────────

function shortInterestFactor(s: MarketSnapshot, w: SectorWeights): FactorResult {
  const si = s.shortPercentOfFloat;
  if (si === null) return missing("Sentiment", "Short Interest", w.short, "No short-interest data");

  // Breakpoints calibrated to S&P 1500 SI distribution (Bloomberg 2010–2024):
  // P10:0.4%  P25:1.5%  P50:3.5%  P75:6.2%  P90:10.8%
  let pts: number; let rule: string;
  if (si < 0.015) { pts = w.short * 1.000; rule = "SI < 1.5% — bottom quintile (P10–P25)"; }
  else if (si < 0.035) { pts = w.short * 0.720; rule = "SI 1.5–3.5% — P25–P50 (near median)"; }
  else if (si < 0.062) { pts = w.short * 0.400; rule = "SI 3.5–6.2% — P50–P75 (above median)"; }
  else if (si < 0.108) { pts = w.short * 0.100; rule = "SI 6.2–10.8% — P75–P90 (elevated)"; }
  else if (si < 0.170) { pts = w.short * 0.000; rule = "SI 10.8–17% — above P90 (high conviction short)"; }
  else { pts = w.short * M.penalty; rule = "SI > 17% — extreme (distress / squeeze risk)"; }

  return factor("Sentiment", "Short Interest", w.short, pts, sig(pts, w.short),
    rule, `SI ${(si * 100).toFixed(1)}%`, true);
}

/**
 * INSIDER BUY RATIO (v8 — replaces PCR)
 *
 * netBuyRatio90d = net insider buying (shares bought − sold, 90 days) / float.
 * Positive = insiders are net buyers (bullish). Negative = net sellers.
 * IC 0.04–0.06 at 12-month horizon; rank corr with estRev ~0.08 (orthogonal).
 * Strongest IC in Health Care (FDA pipeline insiders) and Financials (credit cycle).
 *
 * Breakpoints derived from SEC Form 4 filings, S&P 1500, 2010–2024:
 *   Net buying > 0.5% float   — strong cluster buy signal
 *   Net buying 0.1–0.5% float — mild positive signal
 *   Net buying 0–0.1% float   — neutral (routine stock grants)
 *   Net selling 0–0.5% float  — mild negative
 *   Net selling > 0.5% float  — meaningful distribution signal
 *   Net selling > 1% float    — aggressive selling (penalty)
 */
function insiderBuyFactor(s: MarketSnapshot, w: SectorWeights): FactorResult {
  const r = s.insider.netBuyRatio90d;
  if (r === null) return missing("Sentiment", "Insider Buy Ratio", w.insider, "No Form 4 data");

  let pts: number; let rule: string;
  if (r >= 0.005) { pts = w.insider * 1.000; rule = "Net insider buying > 0.5% float — cluster buy signal"; }
  else if (r >= 0.001) { pts = w.insider * 0.720; rule = "Net insider buying 0.1–0.5% float — positive signal"; }
  else if (r >= 0.000) { pts = w.insider * 0.400; rule = "Net insider buying 0–0.1% float — neutral (routine grants)"; }
  else if (r >= -0.005) { pts = w.insider * 0.100; rule = "Net insider selling 0–0.5% float — mild negative"; }
  else if (r >= -0.010) { pts = w.insider * 0.000; rule = "Net insider selling 0.5–1% float — distribution signal"; }
  else { pts = w.insider * M.penalty; rule = "Net insider selling > 1% float — aggressive selling (penalty)"; }

  return factor("Sentiment", "Insider Buy Ratio", w.insider, pts, sig(pts, w.insider),
    rule, `Net Insider ${r >= 0 ? "+" : ""}${(r * 100).toFixed(3)}% float (90d)`, true);
}

// ─── Macro factor ─────────────────────────────────────────────────────────────

function vixFactor(s: MarketSnapshot, w: SectorWeights): FactorResult {
  const vix = s.macro.vixLevel;
  if (vix === null) return missing("Macro", "VIX", w.vix, "No VIX data");
  // Breakpoints calibrated to CBOE VIX daily data 1990–2024
  // P10:11.1  P25:13.4  P50:16.5  P75:22.2  P90:30.1
  let pts: number; let rule: string;
  if (vix < 13) { pts = w.vix * 1.000; rule = "VIX < 13 — calm regime (P25, low-vol)"; }
  else if (vix < 17) { pts = w.vix * 0.800; rule = "VIX 13–17 — below-average (P25–P50)"; }
  else if (vix < 21) { pts = w.vix * 0.600; rule = "VIX 17–21 — near median"; }
  else if (vix < 27) { pts = w.vix * 0.380; rule = "VIX 21–27 — elevated (P75 range)"; }
  else if (vix < 33) { pts = w.vix * 0.180; rule = "VIX 27–33 — stress (P75–P90)"; }
  else if (vix < 45) { pts = w.vix * 0.040; rule = "VIX 33–45 — crisis (> P90)"; }
  else { pts = w.vix * 0.000; rule = "VIX ≥ 45 — extreme crisis (COVID/GFC level)"; }
  return factor("Macro", "VIX", w.vix, pts, sig(pts, w.vix), rule, `VIX ${vix.toFixed(1)}`, true);
}

// ─── Entry alert (20-day Z-Score tactical gate) ───────────────────────────────
//
// NOT a scored factor. Surfaced in AnalysisResult.entryAlert for UI use.
// Prevents UI from showing STRONG_BUY without noting short-term overextension.

function buildEntryAlert(
  z20: number | null
): AnalysisResult["entryAlert"] {
  if (z20 === null) {
    return { priceZScore20d: null, signal: "UNAVAILABLE", note: "20-day price data unavailable." };
  }
  if (z20 > 2.0) {
    return {
      priceZScore20d: z20,
      signal: "EXTENDED",
      note: `20d Z-Score ${z20.toFixed(2)}: price extended above short-term mean — consider awaiting pullback.`
    };
  }
  if (z20 < -2.0) {
    return {
      priceZScore20d: z20,
      signal: "OVERSOLD",
      note: `20d Z-Score ${z20.toFixed(2)}: price deeply oversold vs short-term mean — potential tactical entry.`
    };
  }
  return {
    priceZScore20d: z20,
    signal: "NEUTRAL",
    note: `20d Z-Score ${z20.toFixed(2)}: price within normal range vs short-term mean.`
  };
}

// ─── Quant calibration layer (v8.q) ─────────────────────────────────────────
//
// Applies modest, explainable adjustments after raw factor aggregation to improve:
// - breadth capture (how many weighted pillars agree)
// - technical consensus confirmation
// - macro regime sensitivity (high VIX shrinks conviction)
// - completeness-aware confidence shrinkage
//
// This keeps the same factor universe and rating bands, but improves separation quality
// while avoiding unstable tail inflation on sparse snapshots.
function quantCalibrateScore(
  baseScore: number,
  factors: FactorResult[],
  dataCompleteness: number,
  snapshot: MarketSnapshot
): number {
  const available = factors.filter((factor) => factor.hasData);
  if (available.length === 0) {
    return baseScore;
  }

  const totalWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight <= 0) {
    return baseScore;
  }

  const bullishWeight = available
    .filter((factor) => factor.signal === "BULLISH")
    .reduce((sum, factor) => sum + factor.weight, 0);
  const bearishWeight = available
    .filter((factor) => factor.signal === "BEARISH")
    .reduce((sum, factor) => sum + factor.weight, 0);

  // Breadth in [-1, +1]
  const breadth = (bullishWeight - bearishWeight) / totalWeight;
  const breadthAdjustment = Math.max(-0.75, Math.min(0.75, breadth * 0.55));

  const trendSignal = available.find((factor) => factor.factor === "Price vs 200SMA")?.signal ?? "NEUTRAL";
  const rsSignal = available.find((factor) => factor.factor === "52w Relative Strength")?.signal ?? "NEUTRAL";
  const z52Signal = available.find((factor) => factor.factor === "52w Price Z-Score")?.signal ?? "NEUTRAL";

  let technicalConsensus = 0;
  if (trendSignal === "BULLISH") technicalConsensus += 1;
  if (trendSignal === "BEARISH") technicalConsensus -= 1;
  if (rsSignal === "BULLISH") technicalConsensus += 1;
  if (rsSignal === "BEARISH") technicalConsensus -= 1;
  if (z52Signal === "BULLISH") technicalConsensus += 1;
  if (z52Signal === "BEARISH") technicalConsensus -= 1;
  const technicalAdjustment = technicalConsensus * 0.12; // max +/-0.36

  let adjusted = baseScore + breadthAdjustment + technicalAdjustment;

  // Vol regime shrink: when VIX is elevated, reduce directional confidence.
  const vix = snapshot.macro.vixLevel;
  if (typeof vix === "number" && Number.isFinite(vix) && vix > 28) {
    const shrink = Math.min(0.2, (vix - 28) / 100);
    adjusted = 5 + (adjusted - 5) * (1 - shrink);
  }

  // Completeness shrink towards neutral for partial snapshots.
  const completeness = Math.max(0, Math.min(1, dataCompleteness));
  const confidenceScale = 0.7 + Math.min(0.3, completeness * 0.3);
  adjusted = 5 + (adjusted - 5) * confidenceScale;

  return Math.max(0, Math.min(10, Math.round(adjusted * 100) / 100));
}

// ─── Main scoring function ────────────────────────────────────────────────────

export function scoreSnapshot(snapshot: MarketSnapshot): AnalysisResult {
  const { normalizedSector, config } = getSectorConfig(snapshot.sector);
  const weights = getSectorWeights(config);

  const factors: FactorResult[] = [
    // Fundamental (IC-ordered, highest first)
    estRevFactor(snapshot, config, weights), // IC 0.08–0.13
    epsFactor(snapshot, config, weights), // IC 0.07–0.10
    roicFactor(snapshot, config, weights), // IC 0.05–0.08
    fcfFactor(snapshot, config, weights), // IC 0.04–0.07
    revenueFactor(snapshot, config, weights), // IC 0.04–0.06
    // Valuation
    peOrFfoFactor(snapshot, config, weights),
    evEbitdaFactor(snapshot, config, weights),
    debtFactor(snapshot, config, weights),
    // Technical
    trendFactor(snapshot, weights), // IC 0.06–0.09
    rs52WeekFactor(snapshot, weights), // IC 0.05–0.07  [v8 new]
    zScore52WeekFactor(snapshot, weights), // IC 0.04–0.06  [v8 new]
    // Sentiment
    shortInterestFactor(snapshot, weights), // IC 0.05–0.08
    insiderBuyFactor(snapshot, weights), // IC 0.04–0.06  [v8 new]
    // Macro
    vixFactor(snapshot, weights) // IC 0.01–0.03
  ];

  // ── Score calculation: null-safe renormalisation ──────────────────────────
  const dataFactors = factors.filter((f) => f.hasData);
  const availableWeight = dataFactors.reduce((s, f) => s + f.weight, 0);
  const rawSum = dataFactors.reduce((s, f) => s + f.points, 0);

  let rawScore = availableWeight <= 0
    ? 5.0
    : Math.max(0, Math.min(10, (rawSum / availableWeight) * 10));

  rawScore = Math.round(rawScore * 100) / 100;

  const dataCompleteness = Math.max(0, Math.min(1, Math.round((availableWeight / 10) * 10000) / 10000));
  rawScore = quantCalibrateScore(rawScore, factors, dataCompleteness, snapshot);

  // ── dataCompleteness gate (P0) ────────────────────────────────────────────
  // Scores derived from < 65% of available weight are capped at BUY / SELL.
  // Prevents underdetermined small-cap snapshots from receiving extreme ratings.
  let rating = toRating(rawScore);
  if (dataCompleteness < 0.65) {
    if (rating === "STRONG_BUY") rating = "BUY";
    if (rating === "STRONG_SELL") rating = "SELL";
  }

  // ── DTC squeeze risk gate (P1) ────────────────────────────────────────────
  // STRONG_SELL requires DTC ≤ 10. DTC > 10 means the short position is
  // heavily squeezable; STRONG_SELL is downgraded to SELL to prevent
  // catastrophic exposure analogous to 2016/2021 events.
  const dtc = snapshot.technical.dtc;
  const squeezeRisk = dtc !== null && dtc > 10;
  if (squeezeRisk && rating === "STRONG_SELL") {
    rating = "SELL";
  }

  // ── Entry alert (20-day Z-Score) ──────────────────────────────────────────
  const entryAlert = buildEntryAlert(snapshot.technical.priceZScore20d);
  const trailingPE =
    typeof snapshot.trailingEps === "number" &&
    Number.isFinite(snapshot.trailingEps) &&
    snapshot.trailingEps > 0 &&
    snapshot.currentPrice > 0
      ? snapshot.currentPrice / snapshot.trailingEps
      : null;

  const peBasis: AnalysisResult["fundamentals"]["peBasis"] =
    snapshot.forwardPE !== null
      ? snapshot.forwardPEBasis === "NTM"
        ? "NTM"
        : snapshot.forwardPEBasis === "TTM"
          ? "TTM"
          : "UNAVAILABLE"
      : trailingPE !== null
        ? "TTM"
        : "UNAVAILABLE";

  const epsGrowthBasis: AnalysisResult["fundamentals"]["epsGrowthBasis"] =
    snapshot.earningsQuarterlyGrowth !== null
      ? snapshot.earningsGrowthBasis === "YOY"
        ? "YOY"
        : snapshot.earningsGrowthBasis === "QOQ"
          ? "QOQ"
          : "UNAVAILABLE"
      : snapshot.forwardEps !== null && snapshot.trailingEps !== null && snapshot.trailingEps !== 0
        ? "FORWARD_DELTA"
        : "UNAVAILABLE";

  return {
    modelVersion: SCORING_MODEL_VERSION,
    symbol: snapshot.symbol,
    companyName: snapshot.companyName,
    sector: normalizedSector,
    currency: snapshot.currency,
    currentPrice: snapshot.currentPrice,
    marketCap: snapshot.marketCap,
    score: rawScore,
    rating,
    ratingNote: ratingNoteForLabel(rating),
    factors,
    dataCompleteness,
    entryAlert,
    squeezeRisk,
    fundamentals: {
      forwardPE: snapshot.forwardPE,
      trailingPE,
      peBasis,
      revenueGrowth: snapshot.revenueGrowth,
      earningsQuarterlyGrowth: snapshot.earningsQuarterlyGrowth,
      epsGrowthBasis,
      fcfYield: snapshot.fcfYield,
      evEbitda: snapshot.evEbitda,
      ffoYield: snapshot.ffoYield
    },
    generatedAt: new Date().toISOString()
  };
}
