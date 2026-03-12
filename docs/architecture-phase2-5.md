# Architecture Guardrails (Phase 2-5)

## Read Path

- User APIs should prefer snapshot/cache-first reads.
- Fast-moving quote/history paths use memory + Redis caches and only fall back to provider polling when snapshot/cache cannot satisfy the request.
- API payload contracts must remain unchanged while internals evolve.

## Layering

- Route handlers (`src/app/api`) are delivery-only and should call feature/snapshot services.
- Route handlers should not import provider adapters or SEC pipeline internals directly.
- Provider calls belong in market/provider or financials pipeline layers.

## Financials Pipeline

- Keep public exports stable from the pipeline entrypoint.
- Keep taxonomy/tag mapping and type surfaces in dedicated modules to reduce pipeline file churn.
- Preserve amendment/restatement and lineage semantics when refactoring internals.

## UI Composition

- Keep `StockDashboard` behavior stable while extracting type/helper surfaces into local modules.
- Prefer incremental decomposition; avoid large render rewrites without tests.

## Operational Checks

- `npm run guard:retired-shims` blocks reintroduction of retired shim imports.
- `npm run check:import-cycles` ensures no import-cycle regressions.
- `npm run guard:route-boundaries` enforces API-layer boundaries.
