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
