import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { redisCacheMode } from "@/lib/cache/redis";

export const runtime = "nodejs";

function hasRedisUrl(): boolean {
  const value = String(process.env.REDIS_URL ?? "").trim();
  return value.length > 0;
}

function redisEnabledFlag(): boolean {
  return String(process.env.USE_REDIS ?? "").trim().toLowerCase() === "true";
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-system-cache",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  const mode = redisCacheMode();
  const useRedis = redisEnabledFlag();
  const urlConfigured = hasRedisUrl();

  return NextResponse.json(
    {
      redis: {
        enabled: mode === "enabled",
        mode,
        useRedisFlag: useRedis,
        urlConfigured
      },
      generatedAt: new Date().toISOString()
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
