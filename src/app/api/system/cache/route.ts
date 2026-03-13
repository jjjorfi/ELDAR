import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { redisCacheMode } from "@/lib/cache/redis";
import { AuthError } from "@/lib/errors";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { verifyCronSecret } from "@/lib/auth";

export const runtime = "nodejs";

function hasRedisUrl(): boolean {
  return env.REDIS_URL.length > 0;
}

function redisEnabledFlag(): boolean {
  return env.USE_REDIS;
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-system-cache",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    verifyCronSecret(request);

    const mode = redisCacheMode();
    const useRedis = redisEnabledFlag();
    const urlConfigured = hasRedisUrl();

    log({
      level: "info",
      service: "api-system-cache",
      message: "Cache config inspected",
      redisMode: mode
    });

    return okResponse(
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
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error, { route: "api-system-cache" });
    }

    return errorResponse(error, { route: "api-system-cache" });
  }
}
