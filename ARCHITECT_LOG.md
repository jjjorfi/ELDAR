# ELDAR Infrastructure Architect Log

## Version
- Realtime stack version: `1.0.1`

## Realtime Coverage (Current)
- Websocket channels now include:
  - `watchlist:updated`
  - `market-movers:updated`
  - `indices-ytd:updated`
  - `earnings:updated`
  - `mag7:updated`
- Original REST API polling remains active as fallback (same hierarchy preserved).
- Signed-out users are supported through anonymous realtime JWTs for public dashboard channels.

## Unified Startup
- Single command to start both services:
```bash
npm run dev:all
```
- Output is merged in one terminal with explicit color-coded prefixes:
  - `[FRONTEND]` in blue
  - `[SOCKET]` in green

## Fail-Fast Validation (Socket Startup)
Realtime server startup now validates config before binding any port.

Validation source:
- `realtime-server/config/shared-config.js`

Rules:
1. `CORS_ORIGIN` must exist.
2. `JWT_SECRET` must exist and be at least 16 chars.
3. `REALTIME_PUBLISH_SECRET` must exist and be at least 16 chars.
4. If `NEXT_PUBLIC_SITE_URL` is set, its origin must be included in `CORS_ORIGIN`.
5. If legacy `SOCKET_JWT_SECRET` exists, it must match `JWT_SECRET`.

Failure behavior:
- Server exits immediately with a plain-English `Architect Alert: ...` message describing exactly what to fix in `.env.local`.

## Shared Env Behavior
- Socket server no longer needs a separate env file.
- It dynamically reads from Next.js root env files:
  - `.env.local` (first)
  - `.env` (fallback)

## Adapter Pattern (Future Redis Toggle)
- State/throttling abstraction now lives at:
  - `realtime-server/adapters/state-adapter.js`
- Toggle:
  - `USE_REDIS=false` => in-memory adapter
  - `USE_REDIS=true` + valid `REDIS_URL` => real Redis-backed adapter
- Safe fallback behavior:
  - If `USE_REDIS=true` but `REDIS_URL` is missing or Redis is unreachable, server auto-falls back to in-memory mode (no crash).
- This keeps business logic untouched while making backend storage swappable later.

## Scaling Trace
- To enable production-grade scaling, set `USE_REDIS=true` and provide a valid `REDIS_URL`.
- Current default mode is in-memory unless Redis is explicitly enabled and reachable.

## Heartbeat Diagnostic Endpoint
- Endpoint:
```bash
GET /status
```
- Returns JSON with:
  - `"CORS": "OK"`
  - `"JWT_VERIFIED": "YES"`
  - `"VERSION": "1.0.1"`
  - adapter + connection/heartbeat metadata
