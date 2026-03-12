// File Purpose:
// - Issues short-lived JWTs for WebSocket handshake authentication.
// - JWT payload contains user identity and optional org identity for room joins.
//
// Integration Points:
// - Frontend hook: /Users/s.bahij/Documents/ELDAR SaaS/src/hooks/useSocket.ts
// - Verified by socket server: /Users/s.bahij/Documents/ELDAR SaaS/realtime-server/server.js
//
// Gotchas:
// - JWT_SECRET must be identical in Next.js and realtime-server.
// - Anonymous visitors receive a scoped anonymous token for public dashboard rooms.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sign } from "jsonwebtoken";

import { runRouteGuards } from "@/lib/api/route-security";

export const runtime = "nodejs";

const REALTIME_HEALTH_TIMEOUT_MS = 700;
const REALTIME_HEALTH_CACHE_TTL_MS = 15_000;

let realtimeHealthCache: { checkedAt: number; available: boolean } | null = null;

interface SocketTokenClaims {
  sub: string;
  userId: string;
  orgId: string | null;
  sessionId: string | null;
  isAnonymous: boolean;
  iss: "eldar-nextjs";
  aud: "eldar-realtime";
}

function socketUrlToHealthUrl(socketUrl: string): string | null {
  try {
    const parsed = new URL(socketUrl);
    if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    }
    return `${parsed.origin.replace(/\/$/, "")}/health`;
  } catch {
    return null;
  }
}

async function isRealtimeReachable(socketUrl: string): Promise<boolean> {
  if (
    realtimeHealthCache &&
    Date.now() - realtimeHealthCache.checkedAt < REALTIME_HEALTH_CACHE_TTL_MS
  ) {
    return realtimeHealthCache.available;
  }

  const healthUrl = socketUrlToHealthUrl(socketUrl);
  if (!healthUrl) {
    realtimeHealthCache = {
      checkedAt: Date.now(),
      available: false
    };
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REALTIME_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
    const available = response.ok;
    realtimeHealthCache = {
      checkedAt: Date.now(),
      available
    };
    return available;
  } catch {
    realtimeHealthCache = {
      checkedAt: Date.now(),
      available: false
    };
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-realtime-token",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  const { userId, orgId, sessionId } = await auth();
  const effectiveUserId = userId ?? `anon:${randomUUID()}`;
  const isAnonymous = !userId;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim().length < 16) {
    console.warn("[Realtime Token API]: JWT_SECRET missing/weak. Realtime socket auth disabled.");
    return NextResponse.json(
      {
        disabled: true,
        reason: "Realtime token service is not configured."
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  const claims: SocketTokenClaims = {
    sub: effectiveUserId,
    userId: effectiveUserId,
    orgId: isAnonymous ? null : orgId ?? null,
    sessionId: isAnonymous ? null : sessionId ?? null,
    isAnonymous,
    iss: "eldar-nextjs",
    aud: "eldar-realtime"
  };

  const token = sign(claims, jwtSecret, {
    expiresIn: "15m"
  });

  const socketUrl = process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4100";
  const realtimeAvailable = await isRealtimeReachable(socketUrl);

  if (!realtimeAvailable) {
    return NextResponse.json(
      {
        disabled: true,
        reason: "Realtime socket server is unavailable. Falling back to HTTP polling."
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  console.log(
    isAnonymous
      ? "[Realtime Token API]: Issued anonymous socket token for public realtime channels."
      : `[Realtime Token API]: Issued socket token for user ${effectiveUserId}${orgId ? ` (org ${orgId})` : ""}`
  );

  return NextResponse.json(
    {
      token,
      socketUrl
    },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}
