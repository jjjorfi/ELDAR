// AI CONTEXT TRACE:
// File Purpose:
// - Bridges Next.js API mutations to the dedicated Socket.IO server (Option 2).
// - Sends DELTA events only (no heavy datasets) via an internal publish endpoint.
//
// Integration Points:
// - Called by /Users/s.bahij/Documents/ELDAR SaaS/src/app/api/watchlist/route.ts after add/remove.
// - Emits payload contracts from /Users/s.bahij/Documents/ELDAR SaaS/src/lib/realtime/events.ts.
// - Target server endpoint: POST /internal/publish on realtime-server.
//
// Gotchas:
// - This helper must never throw in a way that breaks the primary REST response.
// - REALTIME_PUBLISH_SECRET must match the realtime-server value exactly.
// - REALTIME_SERVER_INTERNAL_URL should point to the socket server private URL.

import {
  SOCKET_EVENTS,
  SOCKET_ROOMS,
  type EarningsPayload,
  type IndicesYtdPayload,
  type Mag7Payload,
  type MarketMoversPayload,
  type QuoteTicksPayload,
  type WatchlistDeltaPayload
} from "@/lib/realtime/events";

interface PublishEnvelope {
  room: string;
  event: string;
  payload: unknown;
}

const DEFAULT_REALTIME_INTERNAL_URL = "http://127.0.0.1:4100";

async function publish(envelope: PublishEnvelope): Promise<void> {
  const realtimeUrl = process.env.REALTIME_SERVER_INTERNAL_URL ?? DEFAULT_REALTIME_INTERNAL_URL;
  const publishSecret = process.env.REALTIME_PUBLISH_SECRET;

  if (!publishSecret || publishSecret.trim().length < 16) {
    console.warn("[Realtime Publisher]: REALTIME_PUBLISH_SECRET missing/weak. Skipping publish.");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch(`${realtimeUrl.replace(/\/$/, "")}/internal/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${publishSecret}`
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[Realtime Publisher]: Publish failed (${response.status}) ${body}`);
      return;
    }

    console.log(
      `[Realtime Publisher]: Emitted ${envelope.event} to room ${envelope.room}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown publish error.";
    console.error(`[Realtime Publisher]: Publish request error: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function publishWatchlistDelta(payload: WatchlistDeltaPayload): Promise<void> {
  const targets: string[] = [SOCKET_ROOMS.user(payload.userId)];
  if (payload.orgId) {
    targets.push(SOCKET_ROOMS.org(payload.orgId));
  }

  await Promise.all(
    targets.map((room) =>
      publish({
        room,
        event: SOCKET_EVENTS.WATCHLIST_UPDATED,
        payload
      })
    )
  );
}

export async function publishMarketMovers(payload: MarketMoversPayload): Promise<void> {
  await publish({
    room: SOCKET_ROOMS.publicDashboard(),
    event: SOCKET_EVENTS.MARKET_MOVERS_UPDATED,
    payload
  });
}

export async function publishIndicesYtd(payload: IndicesYtdPayload): Promise<void> {
  await publish({
    room: SOCKET_ROOMS.publicDashboard(),
    event: SOCKET_EVENTS.INDICES_YTD_UPDATED,
    payload
  });
}

export async function publishEarnings(payload: EarningsPayload): Promise<void> {
  await publish({
    room: SOCKET_ROOMS.publicDashboard(),
    event: SOCKET_EVENTS.EARNINGS_UPDATED,
    payload
  });
}

export async function publishMag7(payload: Mag7Payload): Promise<void> {
  await publish({
    room: SOCKET_ROOMS.publicDashboard(),
    event: SOCKET_EVENTS.MAG7_UPDATED,
    payload
  });
}

export async function publishQuoteTicks(payload: QuoteTicksPayload): Promise<void> {
  await publish({
    room: SOCKET_ROOMS.publicDashboard(),
    event: SOCKET_EVENTS.QUOTE_TICKS_UPDATED,
    payload
  });
}
