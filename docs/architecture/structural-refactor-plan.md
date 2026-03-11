# Structural Refactor Plan (Conservative, Incremental)

## Current Bottlenecks (Audit)

1. Flat `market` module mixes adapter ingestion, orchestration, and domain helpers.
2. Flat `scoring` module hides ownership between portfolio/macro/sector logic.
3. API routes still contain business logic and caching concerns in several places.
4. Large feature files (`StockDashboard.tsx`, some API handlers) reduce maintainability.
5. Repeated type definitions (`PriceRange`, quote payload shapes) across UI/API.

## Target Module Boundaries

1. Provider ingestion:
   - `src/lib/market/providers/*`
2. Normalization/orchestration:
   - `src/lib/market/orchestration/*`
3. Universe/reference data:
   - `src/lib/market/universe/*`
4. Analytics/scoring:
   - `src/lib/scoring/portfolio/*`
   - `src/lib/scoring/macro/*`
   - `src/lib/scoring/sector/*`
5. API delivery:
   - thin route handlers under `src/app/api/**`
6. Feature services:
   - `src/lib/features/**` for route/service-level business logic

## ROI-Ranked Cleanup Queue

1. Move adapters + orchestration into explicit market subdomains with compatibility shims.
2. Group scoring by subdomain (portfolio/macro/sector) with compatibility shims.
3. Extract heavy route logic to feature services (`price/*`, `search`, `context`, `earnings`).
4. Consolidate duplicate shared types (`price`, `quotes`, `market snapshot contracts`).
5. Split large UI files into feature-local modules and view-model hooks.

## Phasing Rules

- Prefer file moves + compatibility re-exports first.
- Keep behavior stable; avoid logic changes unless required by organization.
- Move route business logic to services incrementally, one route group at a time.
- Validate each phase with `npm run typecheck` and smoke checks.
