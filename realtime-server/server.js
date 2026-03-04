// AI CONTEXT TRACE:
// File Purpose:
// - Dedicated Socket.IO runtime for ELDAR realtime deltas.
// - Handles JWT handshake, room isolation, heartbeats, throttled emits, and internal publish endpoint.
// - Supports adapter pattern (in-memory / Redis) without changing business logic.
//
// Integration Points:
// - Shared config: /Users/s.bahij/Documents/ELDAR SaaS/realtime-server/config/shared-config.js
// - Adapter factory: /Users/s.bahij/Documents/ELDAR SaaS/realtime-server/adapters/state-adapter.js
// - Next token endpoint: /Users/s.bahij/Documents/ELDAR SaaS/src/app/api/realtime/token/route.ts
// - Realtime publisher: /Users/s.bahij/Documents/ELDAR SaaS/src/lib/realtime/publisher.ts
//
// Gotchas:
// - Startup intentionally fail-fast for required config (Architect Alert).
// - Redis mode auto-falls back to memory when unavailable.
// - REST hierarchy remains intact; websocket is additive + fallback-safe.

const http = require("node:http");
const {
  setInterval: setIntervalSafe,
  clearInterval: clearIntervalSafe,
  setTimeout: setTimeoutSafe,
  clearTimeout: clearTimeoutSafe
} = require("node:timers");

const express = require("express");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { getRealtimeConfig } = require("./config/shared-config");
const { createStateAdapter } = require("./adapters/state-adapter");

const SOCKET_EVENTS = {
  WATCHLIST_UPDATED: "watchlist:updated",
  MARKET_MOVERS_UPDATED: "market-movers:updated",
  INDICES_YTD_UPDATED: "indices-ytd:updated",
  EARNINGS_UPDATED: "earnings:updated",
  MAG7_UPDATED: "mag7:updated",
  HEARTBEAT_PING: "heartbeat:ping",
  HEARTBEAT_PONG: "heartbeat:pong"
};

const ROOM_PREFIX = {
  USER: "user:",
  ORG: "org:",
  PUBLIC: "public:"
};

const PUBLIC_DASHBOARD_ROOM = "public:dashboard";
const INTERNAL_ALLOWED_EVENTS = new Set([
  SOCKET_EVENTS.WATCHLIST_UPDATED,
  SOCKET_EVENTS.MARKET_MOVERS_UPDATED,
  SOCKET_EVENTS.INDICES_YTD_UPDATED,
  SOCKET_EVENTS.EARNINGS_UPDATED,
  SOCKET_EVENTS.MAG7_UPDATED
]);

function normalizeBearerToken(value) {
  if (!value || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function userRoom(userId) {
  return `${ROOM_PREFIX.USER}${userId}`;
}

function orgRoom(orgId) {
  return `${ROOM_PREFIX.ORG}${orgId}`;
}

async function main() {
  let config;
  try {
    config = getRealtimeConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown realtime config validation error.";
    console.error(`[Socket Server]: ${message}`);
    process.exit(1);
  }

  const stateAdapter = await createStateAdapter(config);
  const throttleTimers = new Map();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins,
      credentials: true
    },
    transports: ["websocket", "polling"],
    pingInterval: 25_000,
    pingTimeout: 20_000
  });

  async function ensureThrottleEntry(key) {
    const existing = await stateAdapter.get(key);
    if (existing) return existing;

    const created = {
      timestamps: [],
      pendingEnvelope: null
    };
    await stateAdapter.set(key, created);
    return created;
  }

  async function cleanupThrottleEntry(key, entry) {
    if (entry.timestamps.length === 0 && entry.pendingEnvelope === null && !throttleTimers.has(key)) {
      await stateAdapter.delete(key);
    }
  }

  function emitToRoomNow(envelope) {
    io.to(envelope.room).emit(envelope.event, envelope.payload);
    console.log(
      `[Socket Server]: Emitted event="${envelope.event}" room="${envelope.room}" symbol="${envelope.payload?.symbol ?? "n/a"}"`
    );
  }

  function scheduleTrailingFlush(key, waitMs) {
    if (throttleTimers.has(key)) return;

    const timer = setTimeoutSafe(() => {
      throttleTimers.delete(key);
      void flushTrailing(key);
    }, waitMs);
    throttleTimers.set(key, timer);
  }

  async function flushTrailing(key) {
    const entry = await stateAdapter.get(key);
    if (!entry || !entry.pendingEnvelope) {
      if (entry) {
        await cleanupThrottleEntry(key, entry);
      }
      return;
    }

    const envelope = entry.pendingEnvelope;
    entry.pendingEnvelope = null;
    await stateAdapter.set(key, entry);
    await emitThrottled(envelope);
  }

  async function emitThrottled(envelope) {
    const key = `${envelope.room}:${envelope.event}`;
    const entry = await ensureThrottleEntry(key);
    const now = Date.now();
    const windowStart = now - 1000;
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    if (entry.timestamps.length < config.maxUpdatesPerSecond) {
      entry.timestamps.push(now);
      await stateAdapter.set(key, entry);
      emitToRoomNow(envelope);
      await cleanupThrottleEntry(key, entry);
      return;
    }

    entry.pendingEnvelope = envelope;
    await stateAdapter.set(key, entry);
    const oldest = entry.timestamps[0] || now;
    const waitMs = Math.max(20, 1000 - (now - oldest));
    console.warn(
      `[Socket Server]: Throttling event="${envelope.event}" room="${envelope.room}" wait=${waitMs}ms (max=${config.maxUpdatesPerSecond}/s)`
    );
    scheduleTrailingFlush(key, waitMs);
  }

  app.get("/health", async (_req, res) => {
    const adapterSize = await stateAdapter.size().catch(() => -1);
    res.status(200).json({
      status: "ok",
      service: "eldar-realtime-server",
      connectedClients: io.engine.clientsCount,
      adapterMode: stateAdapter.mode,
      adapterEntries: adapterSize,
      timestamp: new Date().toISOString()
    });
  });

  app.get("/status", async (_req, res) => {
    const adapterSize = await stateAdapter.size().catch(() => -1);
    res.status(200).json({
      CORS: config.corsOrigins.length > 0 ? "OK" : "MISSING",
      JWT_VERIFIED: config.jwtSecret.length >= 16 ? "YES" : "NO",
      VERSION: config.statusVersion,
      ADAPTER: stateAdapter.mode,
      ADAPTER_ENTRIES: adapterSize,
      CONNECTED_CLIENTS: io.engine.clientsCount,
      HEARTBEAT: {
        intervalMs: config.heartbeatIntervalMs,
        timeoutMs: config.heartbeatTimeoutMs
      }
    });
  });

  app.post("/internal/publish", async (req, res) => {
    const authHeader = req.get("authorization");
    const token = normalizeBearerToken(authHeader);
    if (!token || token !== config.publishSecret) {
      console.warn("[Socket Server]: Rejected internal publish request (invalid secret).");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;
    const room = typeof body?.room === "string" ? body.room.trim() : "";
    const event = typeof body?.event === "string" ? body.event.trim() : "";
    const payload = body?.payload ?? null;

    if (!room || !event) {
      return res.status(400).json({ error: "Missing room or event." });
    }

    if (!INTERNAL_ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({ error: "Unsupported event for internal publish." });
    }

    const isKnownRoom =
      room.startsWith(ROOM_PREFIX.USER) ||
      room.startsWith(ROOM_PREFIX.ORG) ||
      room.startsWith(ROOM_PREFIX.PUBLIC);
    if (!isKnownRoom) {
      return res.status(400).json({ error: "Unsupported room type." });
    }

    await emitThrottled({ room, event, payload });
    return res.status(202).json({ ok: true });
  });

  io.use((socket, next) => {
    try {
      const authToken = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : null;
      const headerToken = normalizeBearerToken(socket.handshake.headers.authorization);
      const token = authToken || headerToken;

      if (!token) {
        return next(new Error("Missing socket token."));
      }

      const decoded = jwt.verify(token, config.jwtSecret, {
        audience: config.tokenAudience,
        issuer: config.tokenIssuer,
        algorithms: ["HS256"]
      });

      const userId = typeof decoded?.userId === "string" ? decoded.userId : null;
      const orgId = typeof decoded?.orgId === "string" && decoded.orgId.length > 0 ? decoded.orgId : null;
      if (!userId) {
        return next(new Error("Token missing userId."));
      }

      socket.data.userId = userId;
      socket.data.orgId = orgId;
      socket.data.sessionId = typeof decoded?.sessionId === "string" ? decoded.sessionId : null;
      socket.data.lastPongAt = Date.now();
      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "JWT verification failed.";
      console.error(`[Socket Server]: Handshake JWT verification failed: ${message}`);
      return next(new Error("Unauthorized socket handshake."));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const orgId = socket.data.orgId;
    const sessionId = socket.data.sessionId;

    const userScopedRoom = userRoom(userId);
    socket.join(userScopedRoom);
    socket.join(PUBLIC_DASHBOARD_ROOM);
    console.log(`[Socket Server]: User ${userId} joined room ${userScopedRoom}`);
    console.log(`[Socket Server]: User ${userId} joined public room ${PUBLIC_DASHBOARD_ROOM}`);

    if (orgId) {
      const orgScopedRoom = orgRoom(orgId);
      socket.join(orgScopedRoom);
      console.log(`[Socket Server]: User ${userId} joined org room ${orgScopedRoom}`);
    }

    socket.on(SOCKET_EVENTS.HEARTBEAT_PONG, () => {
      socket.data.lastPongAt = Date.now();
      console.log(`[Socket Server]: Heartbeat pong from user ${userId} (session ${sessionId ?? "n/a"})`);
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[Socket Server]: User ${userId} disconnected (reason="${reason}", socketId=${socket.id})`
      );
    });

    socket.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Unknown socket error.";
      console.error(`[Socket Server]: Socket error for user ${userId}: ${message}`);
    });
  });

  const heartbeatTimer = setIntervalSafe(() => {
    const now = Date.now();

    for (const socket of io.sockets.sockets.values()) {
      try {
        socket.emit(SOCKET_EVENTS.HEARTBEAT_PING, { ts: now });
        const lastPongAt = typeof socket.data.lastPongAt === "number" ? socket.data.lastPongAt : 0;
        if (now - lastPongAt > config.heartbeatTimeoutMs) {
          console.warn(
            `[Socket Server]: Disconnecting stale socket user=${socket.data.userId} socketId=${socket.id} noPongForMs=${now - lastPongAt}`
          );
          socket.disconnect(true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown heartbeat error.";
        console.error(`[Socket Server]: Heartbeat loop error: ${message}`);
      }
    }
  }, config.heartbeatIntervalMs);

  httpServer.listen(config.port, config.host, () => {
    console.log(
      `[Socket Server]: Listening on http://${config.host}:${config.port} (CORS origins: ${config.corsOrigins.join(", ")})`
    );
    console.log(
      `[Socket Server]: Adapter=${stateAdapter.mode} Heartbeat=${config.heartbeatIntervalMs}ms timeout=${config.heartbeatTimeoutMs}ms maxUpdates=${config.maxUpdatesPerSecond}/s`
    );
  });

  async function shutdown(signal) {
    console.log(`[Socket Server]: Received ${signal}. Closing gracefully...`);
    clearIntervalSafe(heartbeatTimer);

    for (const [, timer] of throttleTimers.entries()) {
      clearTimeoutSafe(timer);
    }
    throttleTimers.clear();

    io.close(() => {
      httpServer.close(async () => {
        await stateAdapter.shutdown().catch(() => {
          // no-op
        });
        console.log("[Socket Server]: Shutdown complete.");
        process.exit(0);
      });
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
