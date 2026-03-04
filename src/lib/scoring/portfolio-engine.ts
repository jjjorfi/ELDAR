import type { RatingLabel } from "@/lib/types";
import { applyConfidenceGates } from "@/lib/scoring/portfolio-gating";
import { classifyPeerGroup } from "@/lib/scoring/portfolio-peers";
import type {
  HoldingWithScore,
  PillarResult,
  PortfolioEngineInput,
  PortfolioInputHolding,
  PortfolioRating
} from "@/lib/scoring/portfolio-types";

const MODEL_VERSION = "portfolio-v1.0";
const RISK_FREE_RATE = 0.043;
const TRADING_DAYS = 252;

const BASE_WEIGHTS = {
  return: 0.2,
  risk: 0.2,
  drawdown: 0.15,
  diversification: 0.15,
  implementability: 0.1,
  eldarTilt: 0.2
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function toReturns(points: number[]): number[] {
  if (points.length < 2) return [];
  const output: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(next)) {
      output.push((next - prev) / prev);
    }
  }
  return output;
}

function toCumulativeSeries(returns: number[]): number[] {
  let level = 1;
  return returns.map((dailyReturn) => {
    level *= 1 + dailyReturn;
    return level;
  });
}

function computeMaxDrawdown(series: number[]): number {
  if (series.length === 0) return 0;
  let peak = series[0];
  let maxDrawdown = 0;
  for (const value of series) {
    peak = Math.max(peak, value);
    const drawdown = peak > 0 ? (value - peak) / peak : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }
  return Math.abs(maxDrawdown);
}

function cvar95(returns: number[]): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(sorted.length * 0.05));
  const tail = sorted.slice(0, cutoff);
  return Math.abs(mean(tail));
}

function scoreByRange(value: number, min: number, max: number, invert = false): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = clamp((value - min) / Math.max(max - min, 1e-9), 0, 1);
  return (invert ? 1 - normalized : normalized) * 100;
}

function toPortfolioRating(score: number): RatingLabel {
  if (score >= 7.9) return "STRONG_BUY";
  if (score >= 6.3) return "BUY";
  if (score >= 4.1) return "HOLD";
  if (score >= 2.8) return "SELL";
  return "STRONG_SELL";
}

function starsFromPercentile(percentile: number): 1 | 2 | 3 | 4 | 5 {
  if (percentile >= 90) return 5;
  if (percentile >= 67.5) return 4;
  if (percentile >= 32.5) return 3;
  if (percentile >= 10) return 2;
  return 1;
}

function normalizeHoldings(holdings: PortfolioInputHolding[]): PortfolioInputHolding[] {
  const positive = holdings.filter((holding) => holding.weight > 0);
  if (positive.length === 0) return [];

  const total = positive.reduce((sum, holding) => sum + holding.weight, 0);
  if (total <= 0) return positive.map((holding) => ({ ...holding, weight: 1 / positive.length }));
  return positive.map((holding) => ({ ...holding, weight: holding.weight / total }));
}

function buildFlags(holdings: PortfolioInputHolding[]): string[] {
  if (holdings.length === 0) return [];

  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const topFive = sorted.slice(0, 5).reduce((sum, holding) => sum + holding.weight, 0);
  const hasLargePosition = sorted.some((holding) => holding.weight > 0.2);

  const sectorWeights = new Map<string, number>();
  for (const holding of sorted) {
    const key = holding.sector?.trim() || "Other";
    sectorWeights.set(key, (sectorWeights.get(key) ?? 0) + holding.weight);
  }
  const maxSectorWeight = Math.max(...Array.from(sectorWeights.values()), 0);

  const flags: string[] = [];
  if (topFive > 0.5) flags.push("concentrated");
  if (hasLargePosition) flags.push("position_risk");
  if (maxSectorWeight > 0.4) flags.push("sector_concentration");
  return flags;
}

function buildHoldingsTable(holdings: PortfolioInputHolding[]): HoldingWithScore[] {
  return holdings
    .map((holding) => ({
      ticker: holding.ticker,
      name: holding.name,
      weight: holding.weight,
      eldarScore: holding.eldarScore,
      rating: holding.rating,
      contribution: holding.eldarScore !== null ? holding.weight * holding.eldarScore : 0
    }))
    .sort((a, b) => b.contribution - a.contribution);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatFixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function scorePortfolio(input: PortfolioEngineInput): PortfolioRating {
  const holdings = normalizeHoldings(input.holdings);
  const holdingCount = holdings.length;
  const peerGroup = classifyPeerGroup(holdings);

  const holdingsTable = buildHoldingsTable(holdings);
  const eldarCoveredWeight = holdings
    .filter((holding) => holding.eldarScore !== null)
    .reduce((sum, holding) => sum + holding.weight, 0);
  const eldarCoverage = holdingCount > 0 ? eldarCoveredWeight : 0;

  const weightedEldarNumerator = holdings.reduce((sum, holding) => {
    if (holding.eldarScore === null) return sum;
    return sum + holding.eldarScore * holding.weight;
  }, 0);
  const weightedEldarScore = eldarCoveredWeight > 0 ? weightedEldarNumerator / eldarCoveredWeight : 0;

  const strongBuyWeight = holdings
    .filter((holding) => holding.rating === "STRONG_BUY")
    .reduce((sum, holding) => sum + holding.weight, 0);
  const strongSellWeight = holdings
    .filter((holding) => holding.rating === "STRONG_SELL")
    .reduce((sum, holding) => sum + holding.weight, 0);

  const benchmarkPoints = input.benchmarkPoints.filter((point) => Number.isFinite(point));
  const benchmarkReturns = toReturns(benchmarkPoints);
  const monthsOfHistory = input.monthsOfHistory ?? Math.floor((benchmarkPoints.length / TRADING_DAYS) * 12);

  const alphaDrift = (weightedEldarScore - 5) / 6_000;
  const portfolioReturns =
    benchmarkReturns.length > 0 ? benchmarkReturns.map((ret) => ret + alphaDrift) : [];
  const benchmarkSeries = toCumulativeSeries(benchmarkReturns);
  const portfolioSeries = toCumulativeSeries(portfolioReturns);

  const oneYearReturn = portfolioSeries.length > 0 ? portfolioSeries[portfolioSeries.length - 1] - 1 : 0;
  const benchmarkReturn = benchmarkSeries.length > 0 ? benchmarkSeries[benchmarkSeries.length - 1] - 1 : 0;
  const excessReturn = oneYearReturn - benchmarkReturn;
  const cagr = oneYearReturn;

  const volatility = stdDev(portfolioReturns) * Math.sqrt(TRADING_DAYS);
  const downsideReturns = portfolioReturns.filter((ret) => ret < 0);
  const downsideVol = stdDev(downsideReturns) * Math.sqrt(TRADING_DAYS);
  const sharpe = volatility > 0 ? (cagr - RISK_FREE_RATE) / volatility : 0;
  const sortino = downsideVol > 0 ? (cagr - RISK_FREE_RATE) / downsideVol : sharpe;

  const maxDrawdown = computeMaxDrawdown(portfolioSeries);
  const currentDrawdown = portfolioSeries.length > 0
    ? Math.abs((portfolioSeries[portfolioSeries.length - 1] - Math.max(...portfolioSeries)) / Math.max(...portfolioSeries))
    : 0;
  const cvar = cvar95(portfolioReturns);

  const hhi = holdings.reduce((sum, holding) => sum + holding.weight * holding.weight, 0);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  const topFivePct = [...holdings].sort((a, b) => b.weight - a.weight).slice(0, 5).reduce((sum, holding) => sum + holding.weight, 0);
  const sectorWeights = holdings.reduce<Map<string, number>>((acc, holding) => {
    const sector = holding.sector?.trim() || "Other";
    acc.set(sector, (acc.get(sector) ?? 0) + holding.weight);
    return acc;
  }, new Map<string, number>());
  const sectorHHI = Array.from(sectorWeights.values()).reduce((sum, weight) => sum + weight * weight, 0);

  const maxWeight = holdings.reduce((max, holding) => Math.max(max, holding.weight), 0);
  const turnover = clamp(0.12 + holdingCount * 0.008 + maxWeight * 0.18, 0.08, 0.75);
  const tcDrag = turnover * 0.0035;
  const liquidityTier = holdingCount > 0 ? "Large Cap" : "N/A";

  const flags = buildFlags(holdings);
  const hasMarketHistory = benchmarkReturns.length > 5;

  const returnScore = hasMarketHistory
    ? mean([
      scoreByRange(cagr, -0.2, 0.35),
      scoreByRange(oneYearReturn, -0.25, 0.4),
      scoreByRange(excessReturn, -0.2, 0.2)
    ])
    : 0;

  const riskScore = hasMarketHistory
    ? mean([
      scoreByRange(sharpe, -1, 2.5),
      scoreByRange(volatility, 0.08, 0.42, true),
      scoreByRange(sortino, -1, 3.2)
    ])
    : 0;

  const drawdownScore = hasMarketHistory
    ? mean([
      scoreByRange(maxDrawdown, 0.05, 0.6, true),
      scoreByRange(currentDrawdown, 0.0, 0.2, true),
      scoreByRange(cvar, 0.005, 0.08, true)
    ])
    : 0;

  const diversificationScore = mean([
    scoreByRange(effectiveN, 2, 18),
    scoreByRange(topFivePct, 0.22, 0.75, true),
    scoreByRange(sectorHHI, 0.08, 0.52, true)
  ]);

  const implementabilityScore = mean([
    liquidityTier === "Large Cap" ? 90 : 65,
    scoreByRange(turnover, 0.08, 0.75, true),
    scoreByRange(tcDrag, 0.0, 0.006, true)
  ]);

  const eldarTiltScore = eldarCoverage > 0
    ? mean([
      scoreByRange(weightedEldarScore, 2.0, 9.5),
      scoreByRange(strongBuyWeight, 0.0, 0.8),
      scoreByRange(strongSellWeight, 0.0, 0.3, true)
    ])
    : 0;

  const adjustedEldarWeight =
    eldarCoverage < 0.8
      ? BASE_WEIGHTS.eldarTilt * clamp(eldarCoverage / 0.8, 0, 1)
      : BASE_WEIGHTS.eldarTilt;

  const pillars: PillarResult[] = [
    {
      key: "return",
      label: "Return",
      score: Math.round(returnScore * 10) / 10,
      peerMedian: 50,
      weight: BASE_WEIGHTS.return,
      hasData: hasMarketHistory,
      metrics: {
        cagr: formatPercent(cagr),
        oneYearReturn: formatPercent(oneYearReturn),
        excessReturn: formatSignedPercent(excessReturn)
      },
      flags: []
    },
    {
      key: "risk",
      label: "Risk",
      score: Math.round(riskScore * 10) / 10,
      peerMedian: 50,
      weight: BASE_WEIGHTS.risk,
      hasData: hasMarketHistory,
      metrics: {
        sharpe: formatFixed(sharpe),
        volatility: formatPercent(volatility),
        sortino: formatFixed(sortino)
      },
      flags: []
    },
    {
      key: "drawdown",
      label: "Drawdown",
      score: Math.round(drawdownScore * 10) / 10,
      peerMedian: 50,
      weight: BASE_WEIGHTS.drawdown,
      hasData: hasMarketHistory,
      metrics: {
        maxDrawdown: formatPercent(-maxDrawdown),
        currentDrawdown: formatPercent(-currentDrawdown),
        cvar95: formatPercent(cvar)
      },
      flags: []
    },
    {
      key: "diversification",
      label: "Diversification",
      score: Math.round(diversificationScore * 10) / 10,
      peerMedian: 50,
      weight: BASE_WEIGHTS.diversification,
      hasData: holdingCount > 0,
      metrics: {
        effectiveN: formatFixed(effectiveN, 1),
        topFivePct: formatPercent(topFivePct),
        sectorHHI: formatFixed(sectorHHI, 2)
      },
      flags
    },
    {
      key: "implementability",
      label: "Implementability",
      score: Math.round(implementabilityScore * 10) / 10,
      peerMedian: 50,
      weight: BASE_WEIGHTS.implementability,
      hasData: holdingCount > 0,
      metrics: {
        liquidityTier,
        turnover: formatPercent(turnover),
        tcDrag: formatPercent(tcDrag)
      },
      flags: []
    },
    {
      key: "eldarTilt",
      label: "ELDAR Tilt",
      score: Math.round(eldarTiltScore * 10) / 10,
      peerMedian: 50,
      weight: adjustedEldarWeight,
      hasData: eldarCoverage > 0,
      metrics: {
        weightedScore: formatFixed(weightedEldarScore, 2),
        strongBuyPct: formatPercent(strongBuyWeight),
        strongSellPct: formatPercent(strongSellWeight)
      },
      flags: []
    }
  ];

  const available = pillars.filter((pillar) => pillar.hasData);
  const totalWeight = available.reduce((sum, pillar) => sum + pillar.weight, 0);
  const weightedComposite =
    totalWeight > 0
      ? (available.reduce((sum, pillar) => sum + (pillar.score / 100) * pillar.weight, 0) / totalWeight) * 10
      : 0;
  const compositeScore = Math.round(clamp(weightedComposite, 0, 10) * 100) / 100;

  const dataCompleteness = Math.round((totalWeight / 1.0) * 10000) / 10000;
  const preGatedRating = toPortfolioRating(compositeScore);
  const gated = applyConfidenceGates({
    rating: preGatedRating,
    monthsOfHistory,
    dataCompleteness
  });

  const peerPercentile = clamp(compositeScore * 10, 0, 100);
  const stars = starsFromPercentile(peerPercentile);

  return {
    portfolioId: input.portfolioId,
    asOfDate: input.asOfDate,
    peerGroup,
    compositeScore,
    stars,
    rating: gated.rating,
    pillars,
    holdings: holdingsTable,
    dataCompleteness,
    monthsOfHistory,
    disclaimers: [
      "Portfolio rating is based on trailing historical performance and current holdings composition.",
      "This rating is not a forecast of future returns."
    ],
    modelVersion: MODEL_VERSION,
    confidenceFlags: gated.confidenceFlags,
    peerPercentile,
    riskSeries: {
      portfolio: portfolioSeries,
      benchmark: benchmarkSeries,
      rollingSharpe: portfolioReturns.slice(-24).map((_, index, series) => {
        const start = Math.max(0, index - 11);
        const window = series.slice(start, index + 1);
        const windowVol = stdDev(window) * Math.sqrt(TRADING_DAYS);
        const windowMean = mean(window) * TRADING_DAYS;
        if (windowVol <= 0) return 0;
        return (windowMean - RISK_FREE_RATE) / windowVol;
      })
    }
  };
}

