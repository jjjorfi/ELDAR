// Shared GICS sector definitions used by the dashboard, sectors page, and
// sector sentiment APIs. This keeps the 11-sector universe consistent
// everywhere so no surface silently drifts or truncates sectors.

export interface GicsSectorDefinition {
  etf: string;
  displayName: string;
  sector: string;
  topTickers: readonly string[];
  focusArea: string;
}

export const GICS_SECTORS: readonly GicsSectorDefinition[] = [
  {
    etf: "XLK",
    displayName: "Information Tech",
    sector: "Information Technology",
    topTickers: ["AAPL", "MSFT", "NVDA", "AVGO"],
    focusArea: "Software, Semi-conductors, Hardware"
  },
  {
    etf: "XLF",
    displayName: "Financials",
    sector: "Financials",
    topTickers: ["JPM", "BRK.B", "V", "MA", "BAC"],
    focusArea: "Banks, Insurance, Payment Processors"
  },
  {
    etf: "XLV",
    displayName: "Health Care",
    sector: "Health Care",
    topTickers: ["LLY", "UNH", "JNJ", "ABBV", "PFE"],
    focusArea: "Pharma, Biotech, Managed Care"
  },
  {
    etf: "XLY",
    displayName: "Consumer Discretionary",
    sector: "Consumer Discretionary",
    topTickers: ["AMZN", "TSLA", "HD", "MCD", "NKE"],
    focusArea: "E-commerce, Autos, Retail, Travel"
  },
  {
    etf: "XLC",
    displayName: "Communication Services",
    sector: "Communication Services",
    topTickers: ["META", "GOOGL", "NFLX", "DIS", "VZ"],
    focusArea: "Social Media, Search, Entertainment"
  },
  {
    etf: "XLI",
    displayName: "Industrials",
    sector: "Industrials",
    topTickers: ["CAT", "GE", "UPS", "HON", "BA"],
    focusArea: "Aerospace, Defense, Logistics, Machining"
  },
  {
    etf: "XLP",
    displayName: "Consumer Staples",
    sector: "Consumer Staples",
    topTickers: ["PG", "WMT", "KO", "PEP", "COST"],
    focusArea: "Essential Goods, Beverages, Tobacco"
  },
  {
    etf: "XLE",
    displayName: "Energy",
    sector: "Energy",
    topTickers: ["XOM", "CVX", "COP", "SLB"],
    focusArea: "Oil & Gas Exploration, Equipment"
  },
  {
    etf: "XLU",
    displayName: "Utilities",
    sector: "Utilities",
    topTickers: ["NEE", "SO", "DUK", "SRE"],
    focusArea: "Electric, Gas, & Water Providers"
  },
  {
    etf: "XLRE",
    displayName: "Real Estate",
    sector: "Real Estate",
    topTickers: ["PLD", "AMT", "EQIX", "PSA"],
    focusArea: "REITs, Data Centers, Cell Towers"
  },
  {
    etf: "XLB",
    displayName: "Materials",
    sector: "Materials",
    topTickers: ["LIN", "SHW", "APD", "FCX"],
    focusArea: "Chemicals, Mining, Construction Materials"
  }
] as const;

export const GICS_SECTOR_ETFS = GICS_SECTORS.map((sector) => sector.etf);

export const GICS_SECTOR_ORDER = GICS_SECTORS.reduce<Record<string, number>>((accumulator, sector, index) => {
  accumulator[sector.etf] = index;
  return accumulator;
}, {});
