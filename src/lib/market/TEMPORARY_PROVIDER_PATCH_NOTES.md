# Temporary Provider Patch Notes

Purpose: make the app degrade more gracefully while ELDAR is still building on free-tier market data.

## Why these patches exist

- Yahoo `quoteSummary` has been unstable in fresh uncached runs.
- Finnhub, FMP, and EODHD have shown auth, quota, or plan failures under cold-path verification.
- The UI needs quote/history continuity even when premium fundamentals are not available yet.

## What is temporary

- `twelvedata.ts`
- `alpaca.ts`
- `google-finance.ts`
- `marketstack.ts`
- `temporary-fallbacks.ts`

These files are stopgap quote/history fallbacks only. They are **not** intended to become the permanent premium data architecture.

Additional temporary behavior now in place (latency-only patch):
- Soft per-provider time budgets in `temporary-fallbacks.ts` so a single slow API does not freeze UI reads.
- Short TTL + in-flight dedupe cache in `temporary-fallbacks.ts` to prevent duplicate burst calls during page load.
- Staged quote fallback in `dashboard-quotes.ts` to avoid duplicated provider fan-out.

These are intentionally defensive speed patches for build-phase free tiers and should be re-evaluated once paid feeds are enabled.

The same rule now applies to `sec-companyfacts.ts`: it is a temporary
free-tier fundamentals bridge for U.S. issuers so the product can show real
revenue / EPS / cash-flow numbers while premium fundamentals coverage is still
constrained. Once premium fundamentals are stable, this fallback should be
reviewed and likely demoted to a tertiary rescue path.

## Current temporary ranking

Quote fallback:
1. Alpaca
2. Twelve Data
3. Google Finance
4. marketstack
5. Alpha Vantage

History fallback:
1. Alpaca
2. Twelve Data
3. marketstack
4. Alpha Vantage

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
