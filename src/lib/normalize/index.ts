export type {
  CanonicalQuote,
  CanonicalPriceBar,
  CanonicalChartHistory,
  CanonicalIncomeStatement,
  CanonicalBalanceSheet,
  CanonicalCashFlow,
  CanonicalMacroSeries,
  CanonicalObservation,
  DataProvenance,
  DataSource,
  ChartInterval,
  MacroUnit,
  MacroFrequency
} from "@/lib/normalize/types/canonical";

export type {
  AlpacaSnapshotRaw,
  TwelveDataQuoteRaw,
  FinnhubQuoteRaw,
  TradierQuoteRaw,
  YahooChartBarRaw,
  EdgarParsedIncome,
  EdgarParsedBalance,
  EdgarParsedCashFlow,
  FmpIncomeStatementRaw,
  SimfinIncomeStatementRaw,
  FinnhubFundamentalsRaw,
  FREDResponseRaw,
  YahooMacroObservationRaw
} from "@/lib/normalize/types/providers";

export { normalizeAlpaca } from "@/lib/normalize/adapters/prices/alpaca.adapter";
export { normalizeTwelveData } from "@/lib/normalize/adapters/prices/twelve-data.adapter";
export { normalizeFinnhub } from "@/lib/normalize/adapters/prices/finnhub.adapter";
export { normalizeTradier } from "@/lib/normalize/adapters/prices/tradier.adapter";
export { normalizeYahooChartHistory } from "@/lib/normalize/adapters/prices/yahoo.adapter";
export { normalizeStooqCsvHistory } from "@/lib/normalize/adapters/prices/stooq.adapter";

export {
  normalizeEdgarIncome,
  normalizeEdgarBalance,
  normalizeEdgarCashFlow
} from "@/lib/normalize/adapters/fundamentals/edgar.adapter";
export { normalizeFMPIncome } from "@/lib/normalize/adapters/fundamentals/fmp.adapter";
export { normalizeSimfinIncome } from "@/lib/normalize/adapters/fundamentals/simfin.adapter";
export { normalizeFinnhubFundamentalsIncome } from "@/lib/normalize/adapters/fundamentals/finnhub-fundamentals.adapter";

export { normalizeFRED, fredConvertValue } from "@/lib/normalize/adapters/macro/fred.adapter";
export { normalizeYahooMacroSeries } from "@/lib/normalize/adapters/macro/yahoo-macro.adapter";

export { resolveField, PRIORITY } from "@/lib/normalize/resolver/conflict-resolver";
export {
  checkPrice,
  checkChangePct,
  checkRevenue,
  checkMargin,
  checkTaxRate,
  checkRatio,
  checkMacroValue,
  MACRO_BOUNDS
} from "@/lib/normalize/resolver/sanity-checker";

export {
  AdapterError,
  parseFloatOrNull,
  parseIntOrNull,
  toUpperTicker,
  toISODate,
  parseDateOnly,
  defaultProvenance,
  normalizeRatioOrNull
} from "@/lib/normalize/adapters/_utils";
