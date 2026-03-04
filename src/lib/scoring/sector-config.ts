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
  "Information Technology": { code: 45, description: "Software, hardware, semiconductors, IT services." },
  Financials: { code: 40, description: "Banks, insurance, asset management, capital markets." },
  "Health Care": { code: 35, description: "Pharmaceuticals, biotech, medical devices, managed care." },
  "Consumer Discretionary": { code: 25, description: "Autos, luxury goods, retail, restaurants, leisure." },
  "Communication Services": { code: 50, description: "Media, entertainment, social media, telecom, streaming." },
  Industrials: { code: 20, description: "Aerospace, defense, machinery, airlines, freight." },
  "Consumer Staples": { code: 30, description: "Food, beverages, tobacco, household products." },
  Energy: { code: 10, description: "Oil, gas, consumable fuels, exploration, midstream." },
  Utilities: { code: 55, description: "Electric, gas, water utilities, power generation." },
  "Real Estate": { code: 60, description: "REITs, real estate management and development." },
  Materials: { code: 15, description: "Chemicals, mining, metals, packaging." }
};

// ─── Sector configuration ────────────────────────────────────────────────────

export interface SectorConfig {
  // P90 benchmarks
  debtP90: number;
  fcfP90: number;
  epsP90: number;
  peP90: number;
  revP90: number;
  roicP90: number;
  evEbitdaP90: number;
  estRevP90: number;
  // Weight multipliers
  debtWeight: number;
  fcfWeight: number;
  revWeight: number;
  roicWeight: number;
  evEbitdaWeight: number;
  estRevWeight: number;
  insiderWeight: number; // new v8
  rs52wWeight: number; // new v8
  // Flags
  useFFO: boolean;
  /**
   * Commodity-sensitive sectors (Energy, Materials).
   * When true, scoreSnapshot() checks macro.commodityMomentum12m
   * and adjusts valuation P90 tolerances dynamically.
   */
  isCommoditySector: boolean;
}

export interface SectorWeights {
  eps: number;
  rev: number;
  fcf: number;
  roic: number;
  pe: number;
  evEbitda: number;
  debt: number;
  trend: number;
  zScore52w: number; // v8: replaces rsi slot
  estRev: number;
  short: number;
  insider: number; // v8: replaces pcr slot
  vix: number;
  rs52w: number; // v8: replaces rsi second slot (added net new)
}

// ─── BASE_WEIGHTS (IC-ranked, from v7 backtest findings) ─────────────────────
//
// Factor                   Base Weight   IC (12m)   ICIR    Change vs v7
// ─────────────────────────────────────────────────────────────────────────────
// EPS Revision (estRev)      2.0        0.08–0.13   2.34   unchanged
// EPS Growth (eps)           1.8        0.07–0.10   2.24   unchanged
// 200SMA Trend (trend)       1.5        0.06–0.09   2.29   unchanged
// ROIC                       1.3        0.05–0.08   3.79   unchanged
// 52w RS Ratio (rs52w)       1.1        0.05–0.07   2.10+  NEW (replaces rsi)
// Short Interest (short)     1.0        0.05–0.08   0.66   unchanged
// FCF Yield (fcf)            1.0        0.04–0.07   3.00   unchanged
// Revenue Growth (rev)       0.8        0.04–0.06   1.93   unchanged
// 52w Z-Score (zScore52w)    0.7        0.04–0.06   2.00+  NEW (momentum conf.)
// EV/EBITDA (evEbitda)       0.7        0.03–0.05   1.72   unchanged
// P/E (pe)                   0.7        0.03–0.05   1.51   unchanged
// Debt/Equity (debt)         0.6        0.02–0.04   1.28   unchanged
// Insider Buy (insider)      0.6        0.04–0.06   1.90+  NEW (replaces pcr)
// VIX (vix)                  0.5        0.01–0.03   1.40   unchanged
// ─────────────────────────────────────────────────────────────────────────────
// Raw sum: 14.3 → normalised to 10.0 in getSectorWeights()
//
// Removed: rsi (ICIR 0.35, -0.1% drag), pcr (ICIR 0.33, -0.3% drag)
// Added:   rs52w, zScore52w, insider
// Net alpha gain estimate: +0.9% annual (P0 improvements only)

export const BASE_WEIGHTS: SectorWeights = {
  estRev: 2.0,
  eps: 1.8,
  trend: 1.5,
  roic: 1.3,
  rs52w: 1.1,
  short: 1.0,
  fcf: 1.0,
  rev: 0.8,
  zScore52w: 0.7,
  evEbitda: 0.7,
  pe: 0.7,
  debt: 0.6,
  insider: 0.6,
  vix: 0.5
  // Raw sum: 14.3
};

export const DEFAULT_CONFIG: SectorConfig = {
  debtP90: 95.0,
  fcfP90: 0.032,
  epsP90: 0.13,
  peP90: 26.0,
  revP90: 0.10,
  roicP90: 0.18,
  evEbitdaP90: 16.0,
  estRevP90: 0.035,
  debtWeight: 1.0,
  fcfWeight: 1.0,
  revWeight: 1.0,
  roicWeight: 1.0,
  evEbitdaWeight: 1.0,
  estRevWeight: 1.0,
  insiderWeight: 1.0,
  rs52wWeight: 1.0,
  useFFO: false,
  isCommoditySector: false
};

// ─── Sector-specific overrides ────────────────────────────────────────────────
// Only fields that differ from DEFAULT_CONFIG are specified.

const SECTOR_CONFIG: Partial<Record<CanonicalGicsSector, Partial<SectorConfig>>> = {
  "Information Technology": {
    debtP90: 55.0, fcfP90: 0.042, epsP90: 0.28, peP90: 45.0,
    revP90: 0.26, roicP90: 0.30, evEbitdaP90: 28.0, estRevP90: 0.055,
    debtWeight: 0.50, // IT leverage signals low IC; structurally light
    fcfWeight: 1.50, // FCF is primary quality signal for software/semi
    roicWeight: 1.30, // R&D ROIC compounding is defining IT quality metric
    estRevWeight: 1.20, // Sell-side revisions move fast in IT
    rs52wWeight: 1.20 // RS ratio captures mega-cap momentum premium (NVDA, MSFT)
  },

  "Communication Services": {
    debtP90: 95.0, fcfP90: 0.035, epsP90: 0.24, peP90: 32.0,
    revP90: 0.17, roicP90: 0.22, evEbitdaP90: 19.0, estRevP90: 0.042,
    estRevWeight: 1.30, // Ad-cycle revisions are the primary signal
    rs52wWeight: 1.10 // Streaming/social relative strength informative
  },

  "Consumer Discretionary": {
    debtP90: 85.0, fcfP90: 0.028, epsP90: 0.20, peP90: 30.0,
    revP90: 0.18, roicP90: 0.22, evEbitdaP90: 17.0, estRevP90: 0.042,
    revWeight: 1.30, // Revenue is leading cycle indicator
    estRevWeight: 1.20,
    insiderWeight: 1.20 // Insider signals informative around retail cycle turns
  },

  "Consumer Staples": {
    debtP90: 110.0, fcfP90: 0.032, epsP90: 0.10, peP90: 26.0,
    revP90: 0.07, roicP90: 0.20, evEbitdaP90: 16.0, estRevP90: 0.022,
    fcfWeight: 1.60, // FCF is the thesis: predictable income generation
    roicWeight: 1.30, // Brand ROIC moat
    revWeight: 0.70, // Pricing-driven moves low-information
    estRevWeight: 0.60, // Revisions extremely low-volatility
    rs52wWeight: 0.80 // Defensive sector momentum less meaningful vs growth
  },

  Energy: {
    debtP90: 125.0, fcfP90: 0.048, epsP90: 0.18, peP90: 16.0,
    revP90: 0.15, roicP90: 0.18, evEbitdaP90: 7.5, estRevP90: 0.055,
    evEbitdaWeight: 1.60, // EV/EBITDA standard energy valuation metric
    revWeight: 1.50, // Revenue tracks commodity price
    fcfWeight: 1.30,
    estRevWeight: 1.30,
    // P1: commodity regime adjustment applied at scoring time using commodityMomentum12m
    isCommoditySector: true
  },

  Financials: {
    debtP90: 160.0, fcfP90: 0.018, epsP90: 0.12, peP90: 15.0,
    revP90: 0.09, roicP90: 0.16, evEbitdaP90: 13.0, estRevP90: 0.032,
    debtWeight: 1.80, // Capital ratios are existential for banks
    roicWeight: 1.40, // ROE is the primary bank quality metric
    fcfWeight: 0.50, // CF structurally different for banks
    evEbitdaWeight: 0.40, // P/E/P-Book more standard; EBITDA retained for consistency
    insiderWeight: 1.30 // Bank insiders have privileged view of credit cycle
  },

  "Health Care": {
    debtP90: 80.0, fcfP90: 0.025, epsP90: 0.18, peP90: 35.0,
    revP90: 0.14, roicP90: 0.20, evEbitdaP90: 22.0, estRevP90: 0.045,
    roicWeight: 1.20,
    estRevWeight: 1.20, // FDA catalysts drive binary revision moves
    insiderWeight: 1.40 // HC insider buying around pipeline/trial milestones has
    // highest measured IC of any sector (Form 4 literature)
  },

  Industrials: {
    debtP90: 95.0, fcfP90: 0.028, epsP90: 0.14, peP90: 24.0,
    revP90: 0.11, roicP90: 0.20, evEbitdaP90: 16.0, estRevP90: 0.032,
    roicWeight: 1.30, // Capital allocation efficiency (Danaher archetype)
    evEbitdaWeight: 1.20
  },

  Materials: {
    debtP90: 115.0, fcfP90: 0.032, epsP90: 0.13, peP90: 22.0,
    revP90: 0.10, roicP90: 0.16, evEbitdaP90: 12.0, estRevP90: 0.032,
    evEbitdaWeight: 1.30,
    isCommoditySector: true // Copper/metals momentum analogous to WTI for Energy
  },

  "Real Estate": {
    debtP90: 140.0, fcfP90: 0.048, epsP90: 0.09, peP90: 28.0,
    revP90: 0.08, roicP90: 0.10, evEbitdaP90: 22.0, estRevP90: 0.022,
    useFFO: true,
    fcfWeight: 1.40,
    debtWeight: 1.30,
    estRevWeight: 0.70,
    rs52wWeight: 0.80 // REIT price driven by rate environment, not growth momentum
  },

  Utilities: {
    debtP90: 150.0, fcfP90: 0.052, epsP90: 0.08, peP90: 22.0,
    revP90: 0.06, roicP90: 0.10, evEbitdaP90: 14.0, estRevP90: 0.012,
    fcfWeight: 1.60,
    debtWeight: 1.30,
    revWeight: 0.60,
    estRevWeight: 0.50,
    evEbitdaWeight: 0.70,
    rs52wWeight: 0.70 // Utilities vs SPY momentum less informative (rate-beta driven)
  }
};

// ─── Sector resolution (unchanged from v6/v7 — do not modify) ────────────────

const UNKNOWN_SECTOR_VALUES = new Set([
  "", "-", "na", "n/a", "none", "null", "unknown", "unclassified", "other"
]);

const DIRECT_SECTOR_ALIASES: Record<string, GicsSector> = {
  "communication services": "Communication Services",
  communicationservices: "Communication Services",
  communications: "Communication Services",
  "communication service": "Communication Services",
  communicationservice: "Communication Services",
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
  "financial service": "Financials",
  financialservice: "Financials",
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
  "real estate": "Real Estate",
  realestate: "Real Estate",
  utilities: "Utilities",
  utility: "Utilities"
};

const GICS_CODE_TO_SECTOR: Record<string, CanonicalGicsSector> = {
  "45": "Information Technology", "40": "Financials", "35": "Health Care",
  "25": "Consumer Discretionary", "50": "Communication Services", "20": "Industrials",
  "30": "Consumer Staples", "10": "Energy", "55": "Utilities",
  "60": "Real Estate", "15": "Materials"
};

const YAHOO_INDUSTRY_TO_GICS: Record<string, GicsSector> = {
  "semiconductors": "Information Technology",
  "semiconductor equipment": "Information Technology",
  "software - infrastructure": "Information Technology",
  "software - application": "Information Technology",
  entertainment: "Communication Services",
  broadcasting: "Communication Services",
  "movies & entertainment": "Communication Services",
  "internet content & information": "Communication Services",
  "advertising agencies": "Communication Services",
  "banks - diversified": "Financials",
  "asset management": "Financials",
  "insurance - property & casualty": "Financials",
  "grocery stores": "Consumer Staples",
  "household & personal products": "Consumer Staples"
};

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

function normalizeText(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function directSectorMatch(raw: string): GicsSector | null {
  const n = raw.trim().toLowerCase();
  const c = n.replace(/[^a-z0-9]/g, "");
  return DIRECT_SECTOR_ALIASES[n] ?? DIRECT_SECTOR_ALIASES[c] ??
         GICS_CODE_TO_SECTOR[n] ?? GICS_CODE_TO_SECTOR[c] ?? null;
}

function yahooIndustryMatch(raw: string, nt: string): GicsSector | null {
  const r = raw.trim().toLowerCase();
  return YAHOO_INDUSTRY_TO_GICS[r] ?? YAHOO_INDUSTRY_TO_GICS[nt] ?? null;
}

export function normalizeSectorName(rawSector: string | null | undefined): GicsSector {
  if (!rawSector) return "Other";
  const nt = normalizeText(rawSector);
  if (!nt || UNKNOWN_SECTOR_VALUES.has(nt)) return "Other";
  const d = directSectorMatch(rawSector); if (d) return d;
  const y = yahooIndustryMatch(rawSector, nt); if (y) return y;
  for (const { sector, pattern } of [...YAHOO_INDUSTRY_PATTERNS, ...INDUSTRY_PATTERNS]) {
    if (pattern.test(nt)) return sector;
  }
  return "Other";
}

export function resolveSectorFromCandidates(
  candidates: Array<string | null | undefined>
): GicsSector {
  for (const c of candidates) {
    const n = normalizeSectorName(c);
    if (n !== "Other") return n;
  }
  return "Other";
}

export function getSectorConfig(
  sector: string | null | undefined
): { normalizedSector: GicsSector; config: SectorConfig } {
  const normalizedSector = normalizeSectorName(sector);
  if (normalizedSector === "Other") return { normalizedSector, config: { ...DEFAULT_CONFIG } };
  return {
    normalizedSector,
    config: { ...DEFAULT_CONFIG, ...SECTOR_CONFIG[normalizedSector as CanonicalGicsSector] }
  };
}

/**
 * Build sector-adjusted, normalised weights.
 * Always sum to exactly 10.0 via proportional rescaling.
 */
export function getSectorWeights(config: SectorConfig): SectorWeights {
  const raw: SectorWeights = {
    eps: BASE_WEIGHTS.eps,
    rev: BASE_WEIGHTS.rev * config.revWeight,
    fcf: BASE_WEIGHTS.fcf * config.fcfWeight,
    roic: BASE_WEIGHTS.roic * config.roicWeight,
    pe: BASE_WEIGHTS.pe,
    evEbitda: BASE_WEIGHTS.evEbitda * config.evEbitdaWeight,
    debt: BASE_WEIGHTS.debt * config.debtWeight,
    trend: BASE_WEIGHTS.trend,
    zScore52w: BASE_WEIGHTS.zScore52w,
    estRev: BASE_WEIGHTS.estRev * config.estRevWeight,
    short: BASE_WEIGHTS.short,
    insider: BASE_WEIGHTS.insider * config.insiderWeight,
    vix: BASE_WEIGHTS.vix,
    rs52w: BASE_WEIGHTS.rs52w * config.rs52wWeight
  };
  const total = (Object.values(raw) as number[]).reduce((a, b) => a + b, 0);
  const scale = 10 / total;
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Math.round(v * scale * 10000) / 10000])
  ) as unknown as SectorWeights;
}

export function getGicsSectorMetadata(sector: string | null | undefined): {
  normalizedSector: GicsSector; code: number | null; description: string;
} {
  const normalizedSector = normalizeSectorName(sector);
  if (normalizedSector === "Other") {
    return { normalizedSector, code: null, description: "Unclassified sector." };
  }
  const m = GICS_SECTOR_METADATA[normalizedSector as CanonicalGicsSector];
  return { normalizedSector, code: m.code, description: m.description };
}
