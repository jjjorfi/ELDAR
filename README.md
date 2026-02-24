# ELDAR (Next.js 14)

Production-ready Next.js 14 app that generates **Bullish/Bearish/Hold** ratings from your exact 10-factor model.

## Implemented Scoring Bands

- `+8 to +14` => `🟢 STRONG BUY` (Outperform sector; add position)
- `+6 to +7` => `🟢 BUY` (Attractive; initiate/hold)
- `0 to +5` => `🟡 HOLD` (Market perform; monitor)
- `-1 to -5` => `🔴 SELL` (Underperform; trim)
- `<= -6` => `🔴 STRONG SELL` (Avoid; exit position)

## Exact 10-Factor Model Implemented

1. Macro: Fed Policy (`+3 / -3 / 0`)
2. Macro: GDP vs Consensus (`+2 / -2 / 0`)
3. Fundamental: FCF Yield + Revenue Growth (`+2 / -2 / 0`)
4. Sentiment: News/Headline Pulse (`+2 / -2 / 0`)
5. Seasonality: Month Historical Return (`+1 / -1 / 0`)
6. Technical: 50/200 SMA Trend (`+1 / -1 / 0`)
7. Technical: RSI (14) (`+1 / -1 / 0`)
8. Technical: MACD (`+1 / -1 / 0`)
9. Valuation: Forward P/E vs Sector (`+2 / -2 / 0`)
10. Valuation: Debt/Equity (`+1 / -1 / 0`)

## Stack

- Next.js 14 + TypeScript
- Tailwind CSS 3
- Chart.js 4 (`react-chartjs-2`)
- Yahoo Finance public endpoints (price, profile, valuation, upgrades/downgrades, history)
- FRED + TradingEconomics public feeds for macro inputs
- Alpha Vantage free API (optional fallback for fundamentals, news sentiment, and historical data)
- Finnhub free API (optional sentiment enhancement: recommendation trend + market/news sentiment)
- Vercel Postgres for watchlist + analysis cache (auto table creation)
- Local JSON fallback store when Postgres is not configured

## API Routes

- `POST /api/rate` => Generate rating for ticker
- `GET /api/history?limit=20` => Recent analyses
- `GET /api/watchlist` => Watchlist
- `POST /api/watchlist` => Add symbol
- `DELETE /api/watchlist?symbol=XYZ` => Remove symbol
- `GET /api/health` => Health check

## Data Source Strategy (Professional Fallback Chain)

1. Yahoo Finance public endpoints (primary source for price, profile, fundamentals, valuation, analyst revisions, history).
2. Alpha Vantage (free-tier fallback) for missing overview fields, news sentiment, and full daily history.
3. Finnhub (free-tier enhancement) for recommendation and news sentiment signals.
4. FRED + TradingEconomics for macro factors (Fed policy and GDP surprise).

This design keeps all 10 factors available even when one upstream provider has partial outages or sparse fields.

## Local Run

1. Install Node.js 18.18+.
2. Install dependencies:
   - `npm install`
3. Start dev server:
   - `npm run dev`
4. Open [http://localhost:3000](http://localhost:3000)

## Vercel Deployment (Production)

1. Install Vercel CLI:
   - `npm i -g vercel`
2. Deploy:
   - `vercel`
3. Promote to production:
   - `vercel --prod`
4. In Vercel Dashboard, add **Vercel Postgres** integration to your project.
   - `POSTGRES_URL` is auto-injected.
   - App auto-creates required tables on first request.

If `POSTGRES_URL` is not set, app uses local fallback JSON store (`LOCAL_DB_PATH`).

## Environment

Copy `.env.example` to `.env.local` if needed.

- `POSTGRES_URL` (optional but recommended for production persistence)
- `LOCAL_DB_PATH` (optional fallback)
- `ALPHA_VANTAGE_API_KEY` (optional but strongly recommended for maximum factor coverage)
- `FINNHUB_API_KEY` (optional but strongly recommended for stronger sentiment factor coverage)
- `FMP_API_KEY` (optional fallback)
- `MASSIVE_API_KEY` (optional fallback for options/short-interest)
- `EODHD_API_KEY` (optional fallback for quote + fundamentals when others return N/A)
- `ANALYSIS_CACHE_MINUTES` (optional)
