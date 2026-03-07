// AI CONTEXT TRACE:
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

interface SocketTokenClaims {
  sub: string;
  userId: string;
  orgId: string | null;
  sessionId: string | null;
  isAnonymous: boolean;
  iss: "eldar-nextjs";
  aud: "eldar-realtime";
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
