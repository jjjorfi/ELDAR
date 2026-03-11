# ELDAR Repo Map (Founder Guide)

This is the shortest practical map of the codebase.
Use this doc to request changes without needing to code.

## 1) If you ask for data-source/provider changes

- Market providers (Alpaca, Yahoo, Finnhub, etc):
  - `src/lib/market/providers/*`
- Provider orchestration and merging:
  - `src/lib/market/orchestration/*`
- Symbol universes / sector lists:
  - `src/lib/market/universe/*`

What to ask:
- "Change provider priority for live quotes"
- "Adjust fallback when provider X is down"

## 2) If you ask for scoring logic changes

- Portfolio scoring:
  - `src/lib/scoring/portfolio/*`
- Macro scoring:
  - `src/lib/scoring/macro/*`
- Sector scoring config/data:
  - `src/lib/scoring/sector/*`

What to ask:
- "Change portfolio pillar weights"
- "Update macro regime thresholds"

## 3) If you ask for API behavior changes

Routes (thin wrappers):
- `src/app/api/**/route.ts`

Business logic (where the real work happens):
- `src/lib/features/**`

Current feature services added/refactored:
- Price history/live:
  - `src/lib/features/price/history-service.ts`
  - `src/lib/features/price/live-service.ts`
- Context/search/earnings:
  - `src/lib/features/context/service.ts`
  - `src/lib/features/search/service.ts`
  - `src/lib/features/earnings/service.ts`

What to ask:
- "Change search ranking rules"
- "Change context caching TTL"

## 4) If you ask for dashboard/UI changes

- Main large screen shell:
  - `src/components/StockDashboard.tsx`
- Extracted dashboard modules:
  - `src/components/stock-dashboard/NavigationSidebar.tsx`
  - `src/components/stock-dashboard/view-helpers.tsx`
- Dashboard content cards:
  - `src/components/dashboard/HomeDashboardModules.tsx`

What to ask:
- "Change sidebar icons/order"
- "Change chart hover labels"

## 5) If you ask for snapshots/cache/performance

- Snapshot read/build access:
  - `src/lib/snapshots/*`
- Redis cache client:
  - `src/lib/cache/redis.ts`
- API perf header helper:
  - `src/lib/api/responses.ts`
- Security/rate guard:
  - `src/lib/api/route-security.ts`

What to ask:
- "Increase stale-while-revalidate on dashboard"
- "Warm snapshots for top 100 viewed symbols"

## 6) How data flows (simple)

1. Providers fetch raw data (`market/providers`).
2. Orchestration normalizes/merges (`market/orchestration`).
3. Scoring computes signals (`scoring/*`).
4. Snapshots cache precomputed outputs (`snapshots/*`).
5. API routes call feature services (`features/*`) and return JSON.
6. UI reads APIs and renders components.

## 7) How to request changes efficiently

Use this format:
- Goal: what outcome you want.
- Surface: page/API affected.
- Constraint: speed, accuracy, no UI change, etc.
- Acceptance: exact before/after behavior.

Example:
- Goal: "Make search feel instant"
- Surface: `/api/search` + dashboard command search
- Constraint: "No scoring changes"
- Acceptance: "2nd query under 100ms from cache"

## 8) Safety rule we follow

- We do incremental refactors first (move/extract),
  then logic changes only when needed.
- This keeps your app stable while improving structure.
