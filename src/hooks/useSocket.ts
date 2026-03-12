// File Purpose:
// - Provides a singleton Socket.IO client connection for the Next.js frontend.
// - Handles auth token fetch, connection lifecycle states, and heartbeat pong replies.
//
// Integration Points:
// - Token endpoint: /Users/s.bahij/Documents/ELDAR SaaS/src/app/api/realtime/token/route.ts
// - Event constants: /Users/s.bahij/Documents/ELDAR SaaS/src/lib/realtime/events.ts
// - Consumers: /Users/s.bahij/Documents/ELDAR SaaS/src/components/StockDashboard.tsx
//
// Gotchas:
// - This hook is DELTA-oriented; keep large initial loads on REST.
// - Always clean up listeners in consumers with socket.off(event, handler).
// - If auth expires, this hook can transition to "error" and stop reconnect loops.

"use client";

import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { SOCKET_EVENTS } from "@/lib/realtime/events";

type SocketStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

interface RealtimeTokenResponse {
  token: string;
  socketUrl: string;
  disabled?: boolean;
  reason?: string;
}

interface UseSocketOptions {
  enabled: boolean;
}

interface UseSocketResult {
  socket: Socket | null;
  status: SocketStatus;
  error: string | null;
}

interface SharedSocketState {
  socket: Socket | null;
  token: string | null;
  socketUrl: string | null;
  connectingPromise: Promise<Socket | null> | null;
}

const sharedState: SharedSocketState = {
  socket: null,
  token: null,
  socketUrl: null,
  connectingPromise: null
};

let activeConsumers = 0;
let realtimeDisabledReason: string | null = null;
let lastSoftConnectWarningAtMs = 0;

const SOFT_CONNECT_WARNING_COOLDOWN_MS = 30_000;
const SOFT_CONNECT_ERROR_MARKERS = ["websocket error", "xhr poll error", "timeout", "transport close"];

class RealtimeDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeDisabledError";
  }
}

async function fetchRealtimeToken(): Promise<RealtimeTokenResponse> {
  const response = await fetch("/api/realtime/token", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin"
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<RealtimeTokenResponse> & { error?: string };
  if (payload.disabled === true) {
    throw new RealtimeDisabledError(payload.reason ?? "Realtime token service is disabled.");
  }
  if (!response.ok || typeof payload.token !== "string" || typeof payload.socketUrl !== "string") {
    throw new Error(payload.error ?? "Failed to get realtime token.");
  }

  return {
    token: payload.token,
    socketUrl: payload.socketUrl
  };
}

async function getOrCreateSocket(): Promise<Socket | null> {
  if (realtimeDisabledReason) {
    return null;
  }

  if (sharedState.socket && sharedState.socket.connected) {
    return sharedState.socket;
  }

  if (sharedState.connectingPromise) {
    return sharedState.connectingPromise;
  }

  sharedState.connectingPromise = (async () => {
    const { token, socketUrl } = await fetchRealtimeToken();

    // Force a fresh connection only when endpoint or token changed.
    if (
      sharedState.socket &&
      sharedState.socketUrl === socketUrl &&
      sharedState.token === token &&
      sharedState.socket.connected
    ) {
      return sharedState.socket;
    }

    if (sharedState.socket) {
      sharedState.socket.removeAllListeners();
      sharedState.socket.disconnect();
      sharedState.socket = null;
    }

    const socket = io(socketUrl, {
      autoConnect: true,
      transports: ["websocket"],
      auth: {
        token
      },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 8_000,
      timeout: 10_000
    });

    sharedState.socket = socket;
    sharedState.token = token;
    sharedState.socketUrl = socketUrl;

    console.log(`[useSocket]: Socket initialized against ${socketUrl}`);
    return socket;
  })()
    .catch((error) => {
      if (error instanceof RealtimeDisabledError) {
        realtimeDisabledReason = error.message;
        console.info(`[useSocket]: Realtime disabled: ${error.message}`);
        return null;
      }
      const message = error instanceof Error ? error.message : "Unknown socket bootstrap error.";
      console.error(`[useSocket]: Failed to initialize socket: ${message}`);
      return null;
    })
    .finally(() => {
      sharedState.connectingPromise = null;
    });

  return sharedState.connectingPromise;
}

function disconnectSingletonIfUnused(): void {
  if (activeConsumers > 0) return;
  if (!sharedState.socket) return;

  sharedState.socket.removeAllListeners();
  sharedState.socket.disconnect();
  sharedState.socket = null;
  sharedState.token = null;
  sharedState.socketUrl = null;
  console.log("[useSocket]: Socket disconnected because no active consumers remain.");
}

export function useSocket(options: UseSocketOptions): UseSocketResult {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<SocketStatus>(options.enabled ? "connecting" : "idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!options.enabled) {
      setSocket(null);
      setStatus("idle");
      setError(null);
      return;
    }

    if (realtimeDisabledReason) {
      setSocket(null);
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;
    activeConsumers += 1;
    setStatus("connecting");
    setError(null);

    const attach = async (): Promise<(() => void) | void> => {
      const nextSocket = await getOrCreateSocket();
      if (cancelled || !nextSocket) {
        if (!cancelled) {
          if (realtimeDisabledReason) {
            setStatus("idle");
            setError(null);
          } else {
            setStatus("error");
            setError("Unable to establish realtime connection.");
          }
        }
        return;
      }

      setSocket(nextSocket);
      setStatus(nextSocket.connected ? "connected" : "connecting");

      const onConnect = (): void => {
        if (cancelled) return;
        console.log(`[useSocket]: Connected (id=${nextSocket.id ?? "n/a"})`);
        setStatus("connected");
        setError(null);
      };

      const onDisconnect = (reason: string): void => {
        if (cancelled) return;
        console.warn(`[useSocket]: Disconnected (reason="${reason}")`);
        setStatus("reconnecting");
      };

      const onReconnectAttempt = (attempt: number): void => {
        if (cancelled) return;
        console.log(`[useSocket]: Reconnect attempt ${attempt}`);
        setStatus("reconnecting");
      };

      const onConnectError = (connectError: Error): void => {
        if (cancelled) return;
        const message = connectError?.message ?? "Unknown connection error.";
        const normalized = message.toLowerCase();
        const isSoftError = SOFT_CONNECT_ERROR_MARKERS.some((marker) => normalized.includes(marker));

        if (isSoftError) {
          const nowMs = Date.now();
          if (nowMs - lastSoftConnectWarningAtMs > SOFT_CONNECT_WARNING_COOLDOWN_MS) {
            console.warn(`[useSocket]: Realtime temporarily unavailable (${message}). Using HTTP fallback.`);
            lastSoftConnectWarningAtMs = nowMs;
          }
          setStatus("reconnecting");
          setError(null);
          return;
        }

        console.error(`[useSocket]: Connection error: ${message}`);
        setStatus("error");
        setError(message);
      };

      const onHeartbeatPing = (): void => {
        try {
          nextSocket.emit(SOCKET_EVENTS.HEARTBEAT_PONG, { ts: Date.now() });
        } catch (heartbeatError) {
          const message = heartbeatError instanceof Error ? heartbeatError.message : "Unknown heartbeat response error.";
          console.error(`[useSocket]: Failed heartbeat pong emit: ${message}`);
        }
      };

      nextSocket.on("connect", onConnect);
      nextSocket.on("disconnect", onDisconnect);
      nextSocket.io.on("reconnect_attempt", onReconnectAttempt);
      nextSocket.on("connect_error", onConnectError);
      nextSocket.on(SOCKET_EVENTS.HEARTBEAT_PING, onHeartbeatPing);

      if (nextSocket.connected) {
        onConnect();
      }

      return () => {
        nextSocket.off("connect", onConnect);
        nextSocket.off("disconnect", onDisconnect);
        nextSocket.io.off("reconnect_attempt", onReconnectAttempt);
        nextSocket.off("connect_error", onConnectError);
        nextSocket.off(SOCKET_EVENTS.HEARTBEAT_PING, onHeartbeatPing);
      };
    };

    let detachListeners: (() => void) | undefined;
    void attach().then((cleanup) => {
      if (typeof cleanup === "function") {
        detachListeners = cleanup;
      }
    });

    return () => {
      cancelled = true;
      if (detachListeners) {
        detachListeners();
      }
      setSocket(null);
      activeConsumers = Math.max(0, activeConsumers - 1);
      disconnectSingletonIfUnused();
    };
  }, [options.enabled]);

  return useMemo(
    () => ({
      socket,
      status,
      error
    }),
    [socket, status, error]
  );
}
