// File Purpose:
// - Single source of truth for realtime-server configuration loading + validation.
// - Loads env from Next.js project root (.env.local/.env) so no separate socket env file is needed.
// - Enforces fail-fast "Architect Alert" checks at startup.
//
// Integration Points:
// - /Users/s.bahij/Documents/ELDAR SaaS/realtime-server/server.js imports and uses this module.
// - Works alongside Next.js env usage (process.env) to keep JWT/CORS settings aligned.
//
// Gotchas:
// - This module throws with plain-English errors by design (fail-closed startup).
// - If NEXT_PUBLIC_SITE_URL is set, it must be included in CORS_ORIGIN.

const fs = require("node:fs");
const path = require("node:path");

const TOKEN_ISSUER = "eldar-nextjs";
const TOKEN_AUDIENCE = "eldar-realtime";
const STATUS_VERSION = "1.0.1";
const DEFAULT_STREAM_SYMBOLS = "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,AVGO,NFLX";

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitIndex = trimmed.indexOf("=");
    if (splitIndex <= 0) continue;
    const key = trimmed.slice(0, splitIndex).trim();
    let value = trimmed.slice(splitIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadRootEnv() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  loadEnvFile(path.join(projectRoot, ".env.local"));
  loadEnvFile(path.join(projectRoot, ".env"));
}

function normalizeOrigin(urlOrOrigin) {
  if (!urlOrOrigin) return null;
  try {
    return new URL(urlOrOrigin).origin;
  } catch {
    // If already a raw origin string like http://localhost:3000, URL() still works.
    return null;
  }
}

function architectAlert(message) {
  const error = new Error(`Architect Alert: ${message}`);
  error.name = "ArchitectAlertError";
  throw error;
}

function getRealtimeConfig() {
  loadRootEnv();

  const corsOrigins = parseCsv(process.env.CORS_ORIGIN);
  const jwtSecret = String(process.env.JWT_SECRET ?? "");
  const publishSecret = String(process.env.REALTIME_PUBLISH_SECRET ?? "");
  const frontendSiteOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  const legacySocketJwtSecret = String(process.env.SOCKET_JWT_SECRET ?? "");
  const alpacaKeyId = String(
    process.env.ALPACA_API_KEY ??
    process.env.ALPACA_API_KEY_ID ??
    process.env.APCA_API_KEY_ID ??
    ""
  ).trim();
  const alpacaSecret = String(
    process.env.ALPACA_API_SECRET ??
    process.env.ALPACA_SECRET_KEY ??
    process.env.APCA_API_SECRET_KEY ??
    ""
  ).trim();
  const quoteStreamSymbols = parseCsv(process.env.REALTIME_STREAM_SYMBOLS ?? DEFAULT_STREAM_SYMBOLS)
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => /^[A-Z.\-]{1,12}$/.test(symbol));

  if (corsOrigins.length === 0) {
    architectAlert(
      'CORS_ORIGIN is missing. Add it to .env.local (example: CORS_ORIGIN="http://localhost:3000").'
    );
  }

  if (jwtSecret.trim().length < 16) {
    architectAlert(
      "JWT_SECRET is missing or too short. Set a strong JWT_SECRET (minimum 16 chars) in .env.local."
    );
  }

  if (legacySocketJwtSecret && legacySocketJwtSecret !== jwtSecret) {
    architectAlert(
      "SOCKET_JWT_SECRET does not match JWT_SECRET. Remove SOCKET_JWT_SECRET or make both values identical in .env.local."
    );
  }

  if (publishSecret.trim().length < 16) {
    architectAlert(
      "REALTIME_PUBLISH_SECRET is missing or too short. Set a strong REALTIME_PUBLISH_SECRET (minimum 16 chars) in .env.local."
    );
  }

  if (frontendSiteOrigin && !corsOrigins.includes(frontendSiteOrigin)) {
    architectAlert(
      `CORS_ORIGIN does not include NEXT_PUBLIC_SITE_URL origin (${frontendSiteOrigin}). Add it so frontend and socket handshake stay aligned.`
    );
  }

  return {
    host: process.env.REALTIME_HOST || "0.0.0.0",
    port: parseNumber(process.env.REALTIME_PORT, 4100),
    corsOrigins,
    jwtSecret,
    publishSecret,
    maxUpdatesPerSecond: parseNumber(process.env.REALTIME_MAX_UPDATES_PER_SECOND, 10),
    heartbeatIntervalMs: parseNumber(process.env.REALTIME_HEARTBEAT_INTERVAL_MS, 15_000),
    heartbeatTimeoutMs: parseNumber(process.env.REALTIME_HEARTBEAT_TIMEOUT_MS, 45_000),
    useRedis: String(process.env.USE_REDIS ?? "").toLowerCase() === "true",
    redisUrl: String(process.env.REDIS_URL ?? "").trim(),
    quoteStreamEnabled: parseBoolean(process.env.REALTIME_ALPACA_STREAM, true),
    quoteStreamUrl: String(process.env.REALTIME_ALPACA_STREAM_URL ?? "wss://stream.data.alpaca.markets/v2/iex").trim(),
    quoteStreamFlushMs: parseNumber(process.env.REALTIME_QUOTE_FLUSH_MS, 250),
    quoteStreamReconnectMs: parseNumber(process.env.REALTIME_QUOTE_RECONNECT_MS, 5_000),
    quoteStreamSymbols,
    alpacaKeyId,
    alpacaSecret,
    tokenIssuer: TOKEN_ISSUER,
    tokenAudience: TOKEN_AUDIENCE,
    statusVersion: STATUS_VERSION
  };
}

module.exports = {
  TOKEN_ISSUER,
  TOKEN_AUDIENCE,
  STATUS_VERSION,
  getRealtimeConfig
};
