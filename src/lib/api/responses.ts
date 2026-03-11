// AI CONTEXT TRACE:
// This file centralizes API response helpers used by Next.js route handlers.
// It keeps status codes/messages/headers consistent while avoiding repeated
// `NextResponse.json(...)` boilerplate in each route file.
//
// Connected files:
// - src/app/api/**/route.ts: consumes these helpers for success/error responses.
// - src/lib/api/route-security.ts: can be used together with these helpers to
//   keep guard + response logic clean.
//
// Gotchas for future agents:
// - `jsonNoStore` enforces Cache-Control=no-store and preserves any additional
//   headers passed by callers.
// - `jsonError` defaults to no-store to prevent caching error payloads.

import { NextResponse } from "next/server";

export interface ApiJsonInit extends Omit<ResponseInit, "headers"> {
  headers?: HeadersInit;
}

export interface ApiErrorOptions extends ApiJsonInit {
  noStore?: boolean;
}

export interface ApiPerfOptions {
  startedAt: number;
  cache?: string;
  source?: string;
}

export const NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store"
});

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const source of sources) {
    if (!source) continue;
    const headers = new Headers(source);
    headers.forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

function formatDurationMs(startedAt: number): number {
  const raw = Date.now() - startedAt;
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.round(raw);
}

export function withApiPerfHeaders(
  headers: HeadersInit | undefined,
  options: ApiPerfOptions
): Headers {
  const merged = mergeHeaders(headers);
  const durationMs = formatDurationMs(options.startedAt);

  merged.set("Server-Timing", `app;dur=${durationMs}`);
  merged.set("x-eldar-latency-ms", String(durationMs));

  if (options.cache) {
    merged.set("x-eldar-cache", options.cache);
  }
  if (options.source) {
    merged.set("x-eldar-source", options.source);
  }

  return merged;
}

export function json<T>(payload: T, init?: ApiJsonInit): NextResponse<T> {
  return NextResponse.json(payload, init);
}

export function jsonNoStore<T>(payload: T, init?: ApiJsonInit): NextResponse<T> {
  const headers = mergeHeaders(init?.headers, NO_STORE_HEADERS);
  return NextResponse.json(payload, { ...init, headers });
}

export function jsonError(
  message: string,
  status: number,
  options: ApiErrorOptions = {}
): NextResponse<{ error: string }> {
  const headers = options.noStore === false
    ? options.headers
    : mergeHeaders(options.headers, NO_STORE_HEADERS);
  return NextResponse.json({ error: message }, { ...options, status, headers });
}

export function unauthorized(message = "Unauthorized"): NextResponse<{ error: string }> {
  return jsonError(message, 401);
}

export function badRequest(message: string): NextResponse<{ error: string }> {
  return jsonError(message, 400);
}

export function notFound(message: string): NextResponse<{ error: string }> {
  return jsonError(message, 404);
}

export function internalServerError(message: string): NextResponse<{ error: string }> {
  return jsonError(message, 500);
}
