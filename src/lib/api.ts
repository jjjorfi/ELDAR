import { NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";

export type OkResponseInit = {
  status?: number;
  headers?: HeadersInit;
};

type PaginatedPayload<T> = {
  data: T;
  page: number;
  pageSize: number;
  total: number;
};

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const source of sources) {
    if (!source) {
      continue;
    }
    const headers = new Headers(source);
    headers.forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

/**
 * Builds a standard JSON success response.
 *
 * @param data - Response payload.
 * @param init - Optional status and headers.
 * @returns NextResponse with JSON payload.
 */
export function okResponse<T>(data: T, init: OkResponseInit = {}): NextResponse<T> {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: init.headers
  });
}

/**
 * Builds a standard paginated JSON success response.
 *
 * @param data - Page payload.
 * @param page - Current page number.
 * @param pageSize - Current page size.
 * @param total - Total row count.
 * @param init - Optional status and headers.
 * @returns NextResponse with pagination envelope.
 */
export function paginatedResponse<T>(
  data: T,
  page: number,
  pageSize: number,
  total: number,
  init: OkResponseInit = {}
): NextResponse<PaginatedPayload<T>> {
  return NextResponse.json(
    { data, page, pageSize, total },
    {
      status: init.status ?? 200,
      headers: init.headers
    }
  );
}

/**
 * Converts any thrown error into a stable JSON error response.
 *
 * @param error - Unknown thrown value.
 * @param context - Optional logging context.
 * @returns Structured error response with safe payload.
 */
export function errorResponse(
  error: unknown,
  context: Record<string, unknown> = {},
  headers?: HeadersInit
): NextResponse<{ error: { code: string; message: string; context?: Record<string, unknown> } }> {
  if (error instanceof AppError) {
    log({
      level: error.statusCode >= 500 ? "error" : "warn",
      service: "api",
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      ...context,
      errorContext: error.context
    });

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          context: error.context
        }
      },
      {
        status: error.statusCode,
        headers: mergeHeaders({ "Cache-Control": "no-store" }, headers)
      }
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  log({
    level: "error",
    service: "api",
    message: "Unexpected error",
    ...context,
    error: message
  });

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred"
      }
    },
    {
      status: 500,
      headers: mergeHeaders({ "Cache-Control": "no-store" }, headers)
    }
  );
}
