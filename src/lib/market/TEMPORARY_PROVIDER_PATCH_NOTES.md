# Temporary Provider Patch Notes

Purpose: make the app degrade more gracefully while ELDAR is still building on free-tier market data.

## Why these patches exist

- Yahoo `quoteSummary` has been unstable in fresh uncached runs.
- Finnhub, FMP, and EODHD have shown auth, quota, or plan failures under cold-path verification.
- The UI needs quote/history continuity even when premium fundamentals are not available yet.

## What is temporary

- `twelvedata.ts`
- `google-finance.ts`
- `marketstack.ts`
- `temporary-fallbacks.ts`

These files are stopgap quote/history fallbacks only. They are **not** intended to become the permanent premium data architecture.

The same rule now applies to `sec-companyfacts.ts`: it is a temporary
free-tier fundamentals bridge for U.S. issuers so the product can show real
revenue / EPS / cash-flow numbers while premium fundamentals coverage is still
constrained. Once premium fundamentals are stable, this fallback should be
reviewed and likely demoted to a tertiary rescue path.

## Current temporary ranking

Quote fallback:
1. Twelve Data
2. Google Finance
3. marketstack
4. Alpha Vantage

History fallback:
1. Twelve Data
2. marketstack
3. Alpha Vantage

## What they are allowed to cover

- latest quote rescue
- short/medium-range daily history rescue
- sector ETF history rescue for UI continuity

## What they are not supposed to cover

- EV/EBITDA-quality fundamentals
- institutional-grade insider data
- long-term premium factor coverage

## Removal condition

Once premium provider limits and entitlements are in place, remove or demote these temporary paths so:

1. premium providers remain the primary source of record
2. free-tier rescue logic stops masking provider-quality regressions
3. adapter complexity stays bounded
