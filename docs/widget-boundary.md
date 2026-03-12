# ELDAR Widget Boundary

Widgets are presentation containers.

They may:
- receive canonical objects
- receive orchestrator outputs
- render AI-generated text that was already produced upstream

They may not:
- fetch providers
- compute scores
- call Groq directly
- construct Redis keys
- perform cache invalidation

System rule:

`Widgets render. Orchestrators fetch. Engines compute. AI explains.`

Layering:

1. Data layer: providers -> adapters -> canonical objects -> orchestrators -> cache/db
2. Decision layer: scoring engine / macro engine / portfolio analytics
3. Language layer: AI generators
4. UI layer: widgets/components/pages

Enforcement:

- `npm run guard:widget-boundaries`
- This guard checks `src/components/eldar/widgets` for forbidden imports and tokens.

