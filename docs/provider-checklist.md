# Provider Checklist

Last verified: 2026-03-11T10:46:02.169Z

## Live health snapshot (`/api/health`, admin view)

| Provider | Status | HTTP | Notes |
| --- | --- | --- | --- |
| Yahoo | OK | 200 | Quote/chart reachable. |
| Finnhub | OK | 200 | Quote endpoint reachable. |
| Alpha Vantage | OK | 200 | Quote endpoint reachable. |
| Alpaca | OK | 200 | Latest bars endpoint reachable. |
| FMP | Degraded | 429 | Rate-limited right now. |
| Massive | Degraded | 403 | Auth/plan blocked right now. |
| EODHD | Degraded | 402 | Plan/credit blocked right now. |

## Credential presence (`.env.local`, value presence only)

| Key | Present |
| --- | --- |
| `ALPACA_API_KEY` | Yes |
| `ALPACA_API_SECRET` | Yes |
| `TWELVEDATA_API_KEY` | Yes |
| `FINNHUB_API_KEY` | Yes |
| `ALPHA_VANTAGE_API_KEY` | Yes |
| `FMP_API_KEY` | Yes |
| `EODHD_API_KEY` | Yes |
| `MASSIVE_API_KEY` | Yes |
| `FRED_API_KEY` | Yes |
| `REDIS_URL` | Yes |
| `POSTGRES_URL` | No |
| `CRON_SECRET` | Yes |
| `SEC_CONTACT_EMAIL` / `ELDAR_CONTACT_EMAIL` | No (falls back to `contact@eldar.app`) |

## Provider roles and active usage

### Market prices and intraday

| Provider | Role | Where used |
| --- | --- | --- |
| Alpaca | Tier-1 quote/history fallback and realtime stream source | `src/lib/market/orchestration/temporary-fallbacks.ts`, `realtime-server/server.js`, `src/lib/market/providers/alpaca.ts` |
| Twelve Data | Tier-1 quote/history fallback | `src/lib/market/orchestration/temporary-fallbacks.ts`, `src/lib/market/providers/twelvedata.ts` |
| Yahoo | Core quote/chart feed and macro market series | `src/lib/home/dashboard-quotes.ts`, `src/lib/features/price/history-service.ts`, `src/lib/home/dashboard-macro.ts`, `src/lib/market/providers/yahoo.ts` |
| Finnhub | Quote, earnings, company news | `src/lib/market/providers/finnhub.ts`, `src/lib/features/earnings/service.ts`, `src/lib/home/dashboard-news.ts` |
| Alpha Vantage | Lower-tier quote/history/news fallback | `src/lib/market/providers/alpha-vantage.ts`, `src/lib/market/orchestration/temporary-fallbacks.ts`, `src/lib/home/dashboard-news.ts` |
| FMP | Lower-tier quote/fundamentals fallback, earnings | `src/lib/market/providers/fmp.ts`, `src/lib/features/earnings/service.ts`, `src/lib/home/dashboard-quotes.ts` |
| EODHD | Lower-tier quote/fundamentals fallback | `src/lib/market/providers/eodhd.ts`, `src/lib/home/dashboard-quotes.ts` |
| marketstack | Lower-tier EOD fallback | `src/lib/market/providers/marketstack.ts`, `src/lib/market/orchestration/temporary-fallbacks.ts` |
| Google Finance | Emergency scrape fallback for quotes | `src/lib/market/providers/google-finance.ts`, `src/lib/market/orchestration/temporary-fallbacks.ts` |
| Stooq | Optional fallback (currently disabled in dashboard quotes; used for indices route) | `src/lib/home/dashboard-quotes.ts`, `src/app/api/indices/ytd/route.ts` |

### Fundamentals

| Provider | Role | Where used |
| --- | --- | --- |
| SEC EDGAR | Canonical fundamentals source (primary) | `src/lib/financials/eldar-financials-pipeline.ts` |
| SEC companyfacts bridge | Emergency fallback bridge when canonical build fails | `src/lib/market/providers/sec-companyfacts.ts`, `src/lib/analyze.ts` |
| FMP / EODHD / Alpha Vantage | Supplemental fallback fields only | `src/lib/market/providers/fmp.ts`, `src/lib/market/providers/eodhd.ts`, `src/lib/market/providers/alpha-vantage.ts` |

### Macro

| Provider | Role | Where used |
| --- | --- | --- |
| FRED | Primary macro series (`BAMLH0A0HYM2`, `DFII10`, `T10Y2Y`, `UNRATE`, `CPIAUCSL`, etc.) | `src/lib/home/dashboard-macro.ts`, `src/lib/macro/fred-snapshot.ts` |
| Yahoo market symbols | Market-macro series (`^MOVE`, `^VIX`, `DX-Y.NYB/DX=F`, `CL=F`, `HG=F`, `GC=F`) | `src/lib/home/dashboard-macro.ts` |

## Built-in suppression / protection logic

| Provider | Auth suppression | Rate-limit suppression | Source |
| --- | --- | --- | --- |
| Alpaca | 10m | 60s | `src/lib/market/providers/alpaca.ts` |
| Twelve Data | 10m | 60s | `src/lib/market/providers/twelvedata.ts` |
| Finnhub | 10m on 401/403 | N/A in adapter | `src/lib/market/providers/finnhub.ts` |
| FMP | 10m | 60s | `src/lib/market/providers/fmp.ts` |
| EODHD | 10m | 60s | `src/lib/market/providers/eodhd.ts` |
| marketstack | 10m | 60s | `src/lib/market/providers/marketstack.ts` |
| Yahoo quote-summary | 10m on 401/403 | N/A | `src/lib/market/providers/yahoo.ts` |
| Google Finance scrape fallback | 5m | 5m (shared disable window) | `src/lib/market/providers/google-finance.ts` |

## SEC pipeline rate and safety controls

- Adaptive request interval with defaults:
  - `SEC_BASE_INTERVAL_MS=170`
  - `SEC_MAX_INTERVAL_MS=2000`
  - `SEC_COOLDOWN_FLOOR_MS=1500`
  - `SEC_JITTER_MS=30`
  - `SEC_TIMEOUT_MS=8000`
- SEC contact header is always set using:
  - `SEC_CONTACT_EMAIL` or `ELDAR_CONTACT_EMAIL`, else `contact@eldar.app`
- Source: `src/lib/financials/eldar-financials-pipeline.ts`

## Inactive or not wired into runtime read path

- `Tradier` normalization adapter exists but is not currently part of the active quote orchestration path.
- `Tiingo` is not part of the active provider path in this repository state.
