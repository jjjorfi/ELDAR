// File Purpose:
// - Canonical Drizzle schema for ELDAR financials persistence.
// - Defines profile, quarterly financials, and daily price history tables.
//
// Integration Points:
// - /Users/s.bahij/Documents/ELDAR SaaS/src/lib/financials/eldar-financials-pipeline.ts
//
// Gotchas:
// - Monetary fields are stored in USD actuals (not EDGAR thousands).
// - Quarterly rows are uniquely keyed by (ticker, period_end).

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const eldarCompanyProfile = pgTable("eldar_company_profile", {
  ticker: text("ticker").primaryKey(),
  cik: text("cik").notNull(),
  name: text("name").notNull(),
  exchange: text("exchange"),
  sector: text("sector"),
  sic: text("sic"),
  fiscalYearEnd: text("fiscal_year_end"),
  description: text("description"),
  pipelineVersion: text("pipeline_version").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>().default(null),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});

export const eldarFinancials = pgTable(
  "eldar_financials",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker").notNull(),
    periodEnd: text("period_end").notNull(),
    fiscalYear: integer("fiscal_year").notNull(),
    fiscalQuarter: integer("fiscal_quarter").notNull(),
    formType: text("form_type"),
    filedDate: text("filed_date"),

    revenue: numeric("revenue", { precision: 20, scale: 2 }),
    costOfRevenue: numeric("cost_of_revenue", { precision: 20, scale: 2 }),
    grossProfit: numeric("gross_profit", { precision: 20, scale: 2 }),
    grossMargin: numeric("gross_margin", { precision: 8, scale: 6 }),
    ebit: numeric("ebit", { precision: 20, scale: 2 }),
    ebitda: numeric("ebitda", { precision: 20, scale: 2 }),
    ebitMargin: numeric("ebit_margin", { precision: 8, scale: 6 }),
    ebitdaMargin: numeric("ebitda_margin", { precision: 8, scale: 6 }),
    netIncome: numeric("net_income", { precision: 20, scale: 2 }),
    netMargin: numeric("net_margin", { precision: 8, scale: 6 }),
    epsDiluted: numeric("eps_diluted", { precision: 12, scale: 4 }),
    sharesDiluted: numeric("shares_diluted", { precision: 15, scale: 0 }),

    cash: numeric("cash", { precision: 20, scale: 2 }),
    totalAssets: numeric("total_assets", { precision: 20, scale: 2 }),
    totalDebt: numeric("total_debt", { precision: 20, scale: 2 }),
    netDebt: numeric("net_debt", { precision: 20, scale: 2 }),
    stockholdersEquity: numeric("stockholders_equity", { precision: 20, scale: 2 }),
    sharesOutstanding: numeric("shares_outstanding", { precision: 15, scale: 0 }),

    operatingCashFlow: numeric("operating_cash_flow", { precision: 20, scale: 2 }),
    capex: numeric("capex", { precision: 20, scale: 2 }),
    freeCashFlow: numeric("free_cash_flow", { precision: 20, scale: 2 }),

    priceAtPeriodEnd: numeric("price_at_period_end", { precision: 12, scale: 4 }),
    marketCapAtPeriodEnd: numeric("market_cap_at_period_end", { precision: 20, scale: 2 }),
    enterpriseValue: numeric("enterprise_value", { precision: 20, scale: 2 }),
    evToEbitda: numeric("ev_to_ebitda", { precision: 10, scale: 4 }),
    peRatio: numeric("pe_ratio", { precision: 10, scale: 4 }),
    fcfYield: numeric("fcf_yield", { precision: 10, scale: 6 }),
    roic: numeric("roic", { precision: 10, scale: 6 }),
    roe: numeric("roe", { precision: 10, scale: 6 }),
    roa: numeric("roa", { precision: 10, scale: 6 }),

    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    confidence: text("confidence").notNull(),
    imputedFields: jsonb("imputed_fields").$type<string[]>().default([]),
    warnings: jsonb("warnings").$type<string[]>().default([]),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow(),
    restated: boolean("restated").default(false)
  },
  (table) => ({
    tickerIdx: index("idx_fin_ticker").on(table.ticker),
    periodIdx: index("idx_fin_period").on(table.periodEnd),
    tickerPeriodIdx: uniqueIndex("idx_fin_ticker_period").on(table.ticker, table.periodEnd)
  })
);

export const eldarPriceHistory = pgTable(
  "eldar_price_history",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    open: numeric("open", { precision: 12, scale: 4 }),
    high: numeric("high", { precision: 12, scale: 4 }),
    low: numeric("low", { precision: 12, scale: 4 }),
    close: numeric("close", { precision: 12, scale: 4 }),
    adjClose: numeric("adj_close", { precision: 12, scale: 4 }),
    volume: numeric("volume", { precision: 15, scale: 0 })
  },
  (table) => ({
    tickerIdx: index("idx_prices_ticker").on(table.ticker),
    dateIdx: index("idx_prices_date").on(table.date),
    tickerDate: uniqueIndex("idx_prices_ticker_date").on(table.ticker, table.date)
  })
);

export const eldarFinancialsCache = pgTable("eldar_financials_cache", {
  ticker: text("ticker").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  pipelineVersion: text("pipeline_version").notNull(),
  fundamentalsRefreshedAt: timestamp("fundamentals_refreshed_at", { withTimezone: true }).notNull(),
  pricesRefreshedAt: timestamp("prices_refreshed_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
