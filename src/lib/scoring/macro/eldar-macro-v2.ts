// ELDAR Macro Regime Engine V2.
// This is a dedicated macro overlay model and must not be blended into the
// stock/portfolio scoring engines. Any logic change that affects output should
// bump MACRO_MODEL_VERSION.

export const MACRO_MODEL_VERSION = "eldar-macro-v2.0";

export const INDICATOR_WEIGHTS = {
  move: 4,
  hygOAS: 4,
  realYields: 3,
  yieldCurve: 3,
  oil: 3,
  sahm: 4,
  vix: 2,
  dxy: 2,
  cpi: 2,
  cuAu: 1
} as const;

export const TOTAL_WEIGHT = 28;

export const GATE_RULES = {
  SUPREMACY_PLUMBING_THRESHOLD: -2.0,
  MOVE_HARD_CAP: 120,
  HYG_SOLVENCY_THRESHOLD: 600,
  SAHM_TRIGGER: 0.5,
  SAHM_STRUCTURAL_PENALTY: -1.5,
  OIL_GATE_THRESHOLD: 90,
  REAL_YIELD_RISING_THRESHOLD: 10,
  INFLATION_OVERRIDE_CPI: 4.5,
  INFLATION_OVERRIDE_CAP: 2.0,
  CRISIS_VIX: 35,
  CRISIS_FLOOR: -2.0
} as const;

export const REGIME_THRESHOLDS = {
  MAXIMUM_EXPANSION: 7.5,
  CONSTRUCTIVE_BIAS: 2.5,
  DEFENSIVE_LIQUIDATION: -2.5,
  SYSTEMIC_SHOCK: -7.5
} as const;

export interface MacroInputV2 {
  date: string;
  move: number;
  moveDelta1M: number;
  hygOAS: number;
  hygOASDelta1M: number;
  realYield10Y: number;
  realYieldChange3M: number;
  yieldCurve: number;
  oilWTI: number;
  oilChange1M: number;
  unemploymentRate: number;
  unemployment3MAvg: number;
  unemployment3MMin12: number;
  vix: number;
  dxy: number;
  dxyChange1M: number;
  cpiYoY: number;
  cuAuRatio: number;
  cuAuMa20: number;
}

export type MacroRegimeV2 =
  | "MAXIMUM_EXPANSION"
  | "CONSTRUCTIVE_BIAS"
  | "CHOP_DISTRIBUTION"
  | "DEFENSIVE_LIQUIDATION"
  | "SYSTEMIC_SHOCK";

export interface IndicatorResult {
  name: string;
  weight: number;
  rawScore: number;
  finalScore: number;
  contribution: number;
  rationale: string;
}

export type GateKey =
  | "RULE_OF_SUPREMACY"
  | "MOVE_HARD_CAP"
  | "HYG_SOLVENCY_GATE"
  | "SAHM_HARD_TRIGGER"
  | "OIL_GATE"
  | "INFLATION_OVERRIDE"
  | "CRISIS_FLOOR";

export interface GateFired {
  gate: GateKey;
  reason: string;
  effect: string;
}

export interface PillarSummary {
  name: string;
  pillarWeight: number;
  contribution: number;
  indicators: IndicatorResult[];
}

export interface MacroScoreV2 {
  date: string;
  modelVersion: string;
  compositeScore: number;
  regime: MacroRegimeV2;
  formulaScore: number;
  sahmIndicator: number;
  sahmFired: boolean;
  pillars: {
    plumbing: PillarSummary;
    cycle: PillarSummary;
    sentiment: PillarSummary;
    defense: PillarSummary;
  };
  gatesFired: GateFired[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  warnings: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreMOVE(move: number, delta1M: number): IndicatorResult {
  let levelScore: number;
  if (move < 80) levelScore = 1.0;
  else if (move < 100) levelScore = 0.3;
  else if (move < 120) levelScore = -0.5;
  else levelScore = -1.0;

  let dirScore: number;
  if (delta1M < -10) dirScore = 0.5;
  else if (delta1M < 0) dirScore = 0.2;
  else if (delta1M < 10) dirScore = 0.0;
  else if (delta1M < 25) dirScore = -0.4;
  else dirScore = -1.0;

  const finalScore = clamp(levelScore * 0.65 + dirScore * 0.35, -1, 1);

  return {
    name: "MOVE",
    weight: INDICATOR_WEIGHTS.move,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.move,
    rationale: `MOVE ${move.toFixed(0)} (${delta1M > 0 ? "+" : ""}${delta1M.toFixed(
      0
    )} 1M). ${delta1M > 10 ? "Rising fast." : delta1M < -10 ? "Easing." : "Stable."}`
  };
}

function scoreHYGOAS(oasBps: number, delta1M: number): IndicatorResult {
  let levelScore: number;
  if (oasBps < 300) levelScore = 1.0;
  else if (oasBps < 400) levelScore = 0.4;
  else if (oasBps < 500) levelScore = -0.2;
  else if (oasBps < 650) levelScore = -0.7;
  else levelScore = -1.0;

  let dirScore: number;
  if (delta1M < -30) dirScore = 0.8;
  else if (delta1M < -10) dirScore = 0.4;
  else if (delta1M < 10) dirScore = 0.0;
  else if (delta1M < 30) dirScore = -0.4;
  else dirScore = -1.0;

  const finalScore = clamp(levelScore * 0.6 + dirScore * 0.4, -1, 1);

  return {
    name: "HYG OAS",
    weight: INDICATOR_WEIGHTS.hygOAS,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.hygOAS,
    rationale: `OAS ${oasBps.toFixed(0)}bps (${delta1M > 0 ? "+" : ""}${delta1M.toFixed(
      0
    )}bps 1M). ${delta1M > 20 ? "Widening rapidly." : delta1M < -15 ? "Tightening." : "Stable."}`
  };
}

function scoreRealYields(
  realYield: number,
  change3Mbps: number,
  oilGateActive: boolean
): IndicatorResult {
  let levelScore: number;
  if (realYield < -0.5) levelScore = 1.0;
  else if (realYield < 0.25) levelScore = 0.5;
  else if (realYield < 1.0) levelScore = 0.1;
  else if (realYield < 1.75) levelScore = -0.4;
  else if (realYield < 2.5) levelScore = -0.7;
  else levelScore = -1.0;

  let dirScore: number;
  if (change3Mbps < -30) dirScore = 0.8;
  else if (change3Mbps < -10) dirScore = 0.3;
  else if (change3Mbps < 10) dirScore = 0.0;
  else if (change3Mbps < 40) dirScore = -0.4;
  else dirScore = -1.0;

  const rawScore = clamp(levelScore * 0.6 + dirScore * 0.4, -1, 1);
  const finalScore =
    oilGateActive && change3Mbps > GATE_RULES.REAL_YIELD_RISING_THRESHOLD
      ? -Math.abs(rawScore)
      : rawScore;

  return {
    name: "Real Yields",
    weight: INDICATOR_WEIGHTS.realYields,
    rawScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.realYields,
    rationale: `10Y real yield ${realYield.toFixed(2)}% (${change3Mbps > 0 ? "+" : ""}${change3Mbps.toFixed(
      0
    )}bps 3M).`
  };
}

function scoreYieldCurve(t10y2yBps: number): IndicatorResult {
  let finalScore: number;
  if (t10y2yBps > 125) finalScore = 1.0;
  else if (t10y2yBps > 50) finalScore = 0.5;
  else if (t10y2yBps > 0) finalScore = -0.1;
  else if (t10y2yBps > -50) finalScore = -0.6;
  else finalScore = -1.0;

  return {
    name: "Yield Curve",
    weight: INDICATOR_WEIGHTS.yieldCurve,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.yieldCurve,
    rationale: `T10Y-T2Y ${t10y2yBps > 0 ? "+" : ""}${t10y2yBps.toFixed(0)}bps.`
  };
}

function scoreOil(wti: number, change1M: number): IndicatorResult {
  let levelScore: number;
  if (wti >= 60 && wti <= 85) levelScore = 0.7;
  else if (wti > 50 && wti < 60) levelScore = 0.0;
  else if (wti > 85 && wti <= 95) levelScore = -0.3;
  else if (wti < 45) levelScore = -0.8;
  else levelScore = -0.7;

  let dirScore: number;
  if (change1M < -8) dirScore = -0.8;
  else if (change1M < -3) dirScore = -0.3;
  else if (change1M < 3) dirScore = 0.0;
  else if (change1M < 8) dirScore = -0.2;
  else dirScore = -0.7;

  const finalScore = clamp(levelScore * 0.65 + dirScore * 0.35, -1, 1);

  return {
    name: "Oil (WTI)",
    weight: INDICATOR_WEIGHTS.oil,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.oil,
    rationale: `WTI $${wti.toFixed(0)} (${change1M > 0 ? "+" : ""}${change1M.toFixed(1)}% 1M).`
  };
}

function scoreSahm(
  sahm: number,
  unemploymentRate: number,
  change3MUnemployment: number
): IndicatorResult {
  if (sahm >= GATE_RULES.SAHM_TRIGGER) {
    return {
      name: "Sahm Rule",
      weight: INDICATOR_WEIGHTS.sahm,
      rawScore: -1.0,
      finalScore: -1.0,
      contribution: -INDICATOR_WEIGHTS.sahm,
      rationale: `Sahm triggered at ${sahm.toFixed(2)}pp.`
    };
  }

  let finalScore: number;
  const risingFast = change3MUnemployment > 0.3;
  if (sahm < 0.1 && unemploymentRate < 4.0) finalScore = 1.0;
  else if (sahm < 0.2 && !risingFast) finalScore = 0.5;
  else if (sahm < 0.35) finalScore = 0.0;
  else if (sahm < 0.5 && risingFast) finalScore = -0.7;
  else finalScore = -0.4;

  return {
    name: "Sahm Rule",
    weight: INDICATOR_WEIGHTS.sahm,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.sahm,
    rationale: `Sahm ${sahm.toFixed(2)}pp. Unemployment ${unemploymentRate.toFixed(1)}%.`
  };
}

function scoreVIX(vix: number): IndicatorResult {
  let finalScore: number;
  if (vix < 15) finalScore = 1.0;
  else if (vix < 20) finalScore = 0.3;
  else if (vix < 25) finalScore = -0.2;
  else if (vix < 35) finalScore = -0.7;
  else finalScore = -1.0;

  return {
    name: "VIX",
    weight: INDICATOR_WEIGHTS.vix,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.vix,
    rationale: `VIX ${vix.toFixed(1)}.`
  };
}

function scoreDXY(dxy: number, change1M: number): IndicatorResult {
  let dirScore: number;
  if (change1M < -2.0) dirScore = 1.0;
  else if (change1M < -0.5) dirScore = 0.5;
  else if (change1M < 0.5) dirScore = 0.0;
  else if (change1M < 2.0) dirScore = -0.4;
  else dirScore = -1.0;

  let levelScore: number;
  if (dxy < 96) levelScore = 0.5;
  else if (dxy < 100) levelScore = 0.2;
  else if (dxy < 104) levelScore = -0.1;
  else if (dxy < 108) levelScore = -0.4;
  else levelScore = -0.8;

  const finalScore = clamp(dirScore * 0.6 + levelScore * 0.4, -1, 1);

  return {
    name: "DXY",
    weight: INDICATOR_WEIGHTS.dxy,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.dxy,
    rationale: `DXY ${dxy.toFixed(1)} (${change1M > 0 ? "+" : ""}${change1M.toFixed(1)}% 1M).`
  };
}

function scoreCPI(cpiYoY: number): IndicatorResult {
  let finalScore: number;
  if (cpiYoY < 0.5) finalScore = -0.7;
  else if (cpiYoY < 2.0) finalScore = 0.8;
  else if (cpiYoY < 3.0) finalScore = 0.3;
  else if (cpiYoY < 4.0) finalScore = -0.3;
  else if (cpiYoY < 5.5) finalScore = -0.7;
  else finalScore = -1.0;

  return {
    name: "CPI YoY",
    weight: INDICATOR_WEIGHTS.cpi,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.cpi,
    rationale: `CPI ${cpiYoY.toFixed(1)}% YoY.`
  };
}

function scoreCuAu(cuAuRatio: number, cuAuMa20: number): IndicatorResult {
  if (cuAuMa20 <= 0) {
    return {
      name: "Cu/Au Ratio",
      weight: INDICATOR_WEIGHTS.cuAu,
      rawScore: 0,
      finalScore: 0,
      contribution: 0,
      rationale: "Insufficient Cu/Au data."
    };
  }

  const deviation = (cuAuRatio - cuAuMa20) / cuAuMa20;
  let finalScore: number;
  if (deviation > 0.05) finalScore = 1.0;
  else if (deviation > 0.015) finalScore = 0.5;
  else if (deviation > -0.015) finalScore = 0.0;
  else if (deviation > -0.05) finalScore = -0.5;
  else finalScore = -1.0;

  return {
    name: "Cu/Au Ratio",
    weight: INDICATOR_WEIGHTS.cuAu,
    rawScore: finalScore,
    finalScore,
    contribution: finalScore * INDICATOR_WEIGHTS.cuAu,
    rationale: `Cu/Au ${cuAuRatio.toFixed(5)} vs MA20 ${cuAuMa20.toFixed(5)}.`
  };
}

function compositeToRegime(score: number): MacroRegimeV2 {
  if (score >= REGIME_THRESHOLDS.MAXIMUM_EXPANSION) return "MAXIMUM_EXPANSION";
  if (score >= REGIME_THRESHOLDS.CONSTRUCTIVE_BIAS) return "CONSTRUCTIVE_BIAS";
  if (score > REGIME_THRESHOLDS.DEFENSIVE_LIQUIDATION) return "CHOP_DISTRIBUTION";
  if (score > REGIME_THRESHOLDS.SYSTEMIC_SHOCK) return "DEFENSIVE_LIQUIDATION";
  return "SYSTEMIC_SHOCK";
}

function deriveConfidence(gates: GateFired[], score: number): "HIGH" | "MEDIUM" | "LOW" {
  const supremacyFired = gates.some((gate) => gate.gate === "RULE_OF_SUPREMACY");
  const sahmFired = gates.some((gate) => gate.gate === "SAHM_HARD_TRIGGER");
  if (sahmFired && supremacyFired) return "HIGH";
  if (gates.length >= 3) return "LOW";
  if (gates.length === 0 && Math.abs(score) > 4) return "HIGH";
  return "MEDIUM";
}

export function scoreMacroV2(input: MacroInputV2): MacroScoreV2 {
  const warnings: string[] = [];
  const gatesFired: GateFired[] = [];

  const sahmIndicator = input.unemployment3MAvg - input.unemployment3MMin12;
  const sahmFired = sahmIndicator >= GATE_RULES.SAHM_TRIGGER;
  const oilGateActive = input.oilWTI > GATE_RULES.OIL_GATE_THRESHOLD;
  const unemploymentChange3M = input.unemployment3MAvg - input.unemployment3MMin12;

  const iMOVE = scoreMOVE(input.move, input.moveDelta1M);
  const iHYGOAS = scoreHYGOAS(input.hygOAS, input.hygOASDelta1M);
  const iRealYields = scoreRealYields(input.realYield10Y, input.realYieldChange3M, oilGateActive);
  const iYieldCurve = scoreYieldCurve(input.yieldCurve);
  const iOil = scoreOil(input.oilWTI, input.oilChange1M);
  const iSahm = scoreSahm(sahmIndicator, input.unemploymentRate, unemploymentChange3M);
  const iVIX = scoreVIX(input.vix);
  const iDXY = scoreDXY(input.dxy, input.dxyChange1M);
  const iCPI = scoreCPI(input.cpiYoY);
  const iCuAu = scoreCuAu(input.cuAuRatio, input.cuAuMa20);

  const plumbingIndicators = [iMOVE, iHYGOAS];
  const cycleIndicators = [iRealYields, iYieldCurve, iOil, iSahm];
  const sentimentIndicators = [iVIX, iDXY, iCPI];
  const defenseIndicators = [iCuAu];
  const allIndicators = [...plumbingIndicators, ...cycleIndicators, ...sentimentIndicators, ...defenseIndicators];

  const plumbingContrib = plumbingIndicators.reduce((sum, item) => sum + item.contribution, 0);
  const cycleContrib = cycleIndicators.reduce((sum, item) => sum + item.contribution, 0);
  const sentimentContrib = sentimentIndicators.reduce((sum, item) => sum + item.contribution, 0);
  const defenseContrib = defenseIndicators.reduce((sum, item) => sum + item.contribution, 0);

  const pillars = {
    plumbing: {
      name: "Plumbing",
      pillarWeight: 40,
      contribution: plumbingContrib,
      indicators: plumbingIndicators
    },
    cycle: {
      name: "Cycle",
      pillarWeight: 30,
      contribution: cycleContrib,
      indicators: cycleIndicators
    },
    sentiment: {
      name: "Sentiment",
      pillarWeight: 20,
      contribution: sentimentContrib,
      indicators: sentimentIndicators
    },
    defense: {
      name: "Defense",
      pillarWeight: 10,
      contribution: defenseContrib,
      indicators: defenseIndicators
    }
  };

  let rawWeightedSum = allIndicators.reduce((sum, item) => sum + item.contribution, 0);
  if (sahmFired) {
    rawWeightedSum += GATE_RULES.SAHM_STRUCTURAL_PENALTY;
    gatesFired.push({
      gate: "SAHM_HARD_TRIGGER",
      reason: `Sahm indicator ${sahmIndicator.toFixed(2)} >= 0.50`,
      effect: `Sahm score forced to -1.0 and structural penalty ${GATE_RULES.SAHM_STRUCTURAL_PENALTY} applied.`
    });
    warnings.push(`Sahm Rule triggered at ${sahmIndicator.toFixed(2)}pp.`);
  }

  const formulaScore = clamp((rawWeightedSum / TOTAL_WEIGHT) * 10, -10, 10);
  let compositeScore = formulaScore;

  if (oilGateActive && input.realYieldChange3M > GATE_RULES.REAL_YIELD_RISING_THRESHOLD) {
    gatesFired.push({
      gate: "OIL_GATE",
      reason: `WTI ${input.oilWTI.toFixed(0)} > 90 and real yields rose ${input.realYieldChange3M.toFixed(0)}bps`,
      effect: "Real yield contribution flipped negative."
    });
    warnings.push("Oil gate active: rising real yields are being treated as stagflationary.");
  }

  if (input.hygOAS > GATE_RULES.HYG_SOLVENCY_THRESHOLD) {
    const gatedSentimentContrib = Math.min(sentimentContrib, 0);
    const sentimentDelta = gatedSentimentContrib - sentimentContrib;
    if (sentimentDelta < 0) {
      compositeScore = clamp(((rawWeightedSum + sentimentDelta) / TOTAL_WEIGHT) * 10, -10, 10);
      gatesFired.push({
        gate: "HYG_SOLVENCY_GATE",
        reason: `HYG OAS ${input.hygOAS.toFixed(0)}bps > ${GATE_RULES.HYG_SOLVENCY_THRESHOLD}bps`,
        effect: "Positive sentiment contribution removed."
      });
      warnings.push(`Credit spreads at ${input.hygOAS.toFixed(0)}bps are overriding positive sentiment.`);
    }
  }

  if (input.move > GATE_RULES.MOVE_HARD_CAP && compositeScore > 0) {
    compositeScore = 0;
    gatesFired.push({
      gate: "MOVE_HARD_CAP",
      reason: `MOVE ${input.move.toFixed(0)} > ${GATE_RULES.MOVE_HARD_CAP}`,
      effect: "Composite score capped at 0."
    });
    warnings.push(`MOVE hard cap active at ${input.move.toFixed(0)}.`);
  }

  if (plumbingContrib < GATE_RULES.SUPREMACY_PLUMBING_THRESHOLD) {
    compositeScore = Math.min(compositeScore, -0.1);
    gatesFired.push({
      gate: "RULE_OF_SUPREMACY",
      reason: `Plumbing contribution ${plumbingContrib.toFixed(2)} < ${GATE_RULES.SUPREMACY_PLUMBING_THRESHOLD}`,
      effect: "Composite score forced negative."
    });
    warnings.push(`Plumbing stress is forcing the regime negative (${plumbingContrib.toFixed(2)}).`);
  }

  if (input.cpiYoY > GATE_RULES.INFLATION_OVERRIDE_CPI && compositeScore > GATE_RULES.INFLATION_OVERRIDE_CAP) {
    compositeScore = GATE_RULES.INFLATION_OVERRIDE_CAP;
    gatesFired.push({
      gate: "INFLATION_OVERRIDE",
      reason: `CPI ${input.cpiYoY.toFixed(1)}% > ${GATE_RULES.INFLATION_OVERRIDE_CPI}%`,
      effect: `Composite score capped at ${GATE_RULES.INFLATION_OVERRIDE_CAP.toFixed(1)}.`
    });
    warnings.push(`Inflation override active at ${input.cpiYoY.toFixed(1)}% CPI.`);
  }

  if (input.vix > GATE_RULES.CRISIS_VIX && compositeScore > GATE_RULES.CRISIS_FLOOR) {
    compositeScore = GATE_RULES.CRISIS_FLOOR;
    gatesFired.push({
      gate: "CRISIS_FLOOR",
      reason: `VIX ${input.vix.toFixed(1)} > ${GATE_RULES.CRISIS_VIX}`,
      effect: `Composite score floored at ${GATE_RULES.CRISIS_FLOOR.toFixed(1)}.`
    });
    warnings.push(`Crisis floor active at VIX ${input.vix.toFixed(1)}.`);
  }

  compositeScore = clamp(compositeScore, -10, 10);

  return {
    date: input.date,
    modelVersion: MACRO_MODEL_VERSION,
    compositeScore: Number(compositeScore.toFixed(2)),
    regime: compositeToRegime(compositeScore),
    formulaScore: Number(formulaScore.toFixed(2)),
    sahmIndicator: Number(sahmIndicator.toFixed(3)),
    sahmFired,
    pillars,
    gatesFired,
    confidence: deriveConfidence(gatesFired, compositeScore),
    warnings
  };
}
