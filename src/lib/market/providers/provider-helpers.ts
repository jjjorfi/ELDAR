import {
  getFetchSignal,
  setUrlSearchParams,
  toRecord,
  type QueryParamValue
} from "@/lib/market/adapter-utils";
import { log } from "@/lib/logger";

/**
 * Shared options for provider suppression state.
 */
export interface ProviderSuppressionOptions {
  adapterLabel: string;
  formatMessage?: (label: string, ttlMs: number) => string;
}

/**
 * Classification returned when a provider payload should trigger a temporary
 * suppression window.
 */
export interface ProviderSuppressionClassification {
  ttlMs: number;
  label: string;
}

/**
 * Mutable suppression controller used by provider adapters to back off after
 * auth and rate-limit failures.
 */
export interface ProviderSuppressionController {
  /**
   * Returns true when the adapter should skip outbound requests for now.
   */
  isSuppressed(nowMs?: number): boolean;

  /**
   * Applies a temporary suppression window and logs the suppression once per
   * TTL window.
   */
  suppress(ttlMs: number, label: string): void;
}

/**
 * Creates an in-memory suppression controller for a provider adapter.
 *
 * @param options Adapter label and optional custom log formatter.
 * @returns Suppression controller instance scoped to one adapter module.
 */
export function createProviderSuppression(
  options: ProviderSuppressionOptions
): ProviderSuppressionController {
  let disabledUntil = 0;
  let warnedAt = 0;

  return {
    isSuppressed(nowMs = Date.now()): boolean {
      return nowMs < disabledUntil;
    },

    suppress(ttlMs: number, label: string): void {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        return;
      }

      const now = Date.now();
      disabledUntil = now + ttlMs;

      if (now - warnedAt <= ttlMs) {
        return;
      }

      warnedAt = now;
      const message = options.formatMessage
        ? options.formatMessage(label, ttlMs)
        : `[${options.adapterLabel} Adapter]: temporary ${label} suppression for ${Math.round(ttlMs / 1000)}s.`;
      log({
        level: "warn",
        service: "provider-suppression",
        message,
        adapter: options.adapterLabel,
        label,
        ttlMs
      });
    }
  };
}

/**
 * Options for mapping HTTP statuses into provider suppression windows.
 */
export interface ProviderHttpSuppressionOptions {
  status: number;
  suppression: ProviderSuppressionController;
  authTtlMs: number;
  rateLimitTtlMs: number;
  authStatuses?: number[];
  rateLimitStatuses?: number[];
}

/**
 * Options for the shared JSON request helper used by provider adapters that
 * expose object-like payloads.
 */
export interface ProviderJsonRequestOptions {
  adapterLabel: string;
  service: string;
  baseUrl: string;
  path: string;
  params?: Record<string, QueryParamValue>;
  headers?: Record<string, string>;
  timeoutMs: number;
  suppression: ProviderSuppressionController;
  authTtlMs: number;
  rateLimitTtlMs: number;
  authStatuses?: number[];
  rateLimitStatuses?: number[];
  classifyPayloadFailure?: (payload: Record<string, unknown>) => ProviderSuppressionClassification | null;
}

const DEFAULT_AUTH_STATUSES = [401, 403];
const DEFAULT_RATE_LIMIT_STATUSES = [402, 429];

/**
 * Builds a stable candidate symbol list for providers that accept multiple
 * ticker shapes for the same security.
 *
 * @param symbol Raw input ticker.
 * @param variants Additional symbol transformations to include.
 * @returns Deduplicated uppercase candidates in priority order.
 */
export function buildSymbolCandidates(
  symbol: string,
  variants: Array<(upper: string) => string> = []
): string[] {
  const upper = symbol.trim().toUpperCase();
  if (!upper) {
    return [];
  }

  return Array.from(
    new Set(
      [upper, ...variants.map((variant) => variant(upper))]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

/**
 * Builds candidate symbols for providers that prefer dash-separated class-share
 * tickers such as `BRK-B`.
 *
 * @param symbol Raw input ticker.
 * @returns Deduplicated uppercase candidates in priority order.
 */
export function buildDashedSymbolCandidates(symbol: string): string[] {
  return buildSymbolCandidates(symbol, [(upper) => upper.replace(/\./g, "-")]);
}

/**
 * Builds candidate symbols for providers that may expect either dashed or
 * dotted class-share tickers.
 *
 * @param symbol Raw input ticker.
 * @returns Deduplicated uppercase candidates in priority order.
 */
export function buildDashedAndDottedSymbolCandidates(symbol: string): string[] {
  return buildSymbolCandidates(symbol, [
    (upper) => upper.replace(/\./g, "-"),
    (upper) => upper.replace(/-/g, ".")
  ]);
}

/**
 * Applies provider suppression for HTTP statuses that indicate auth or
 * rate-limit failures.
 *
 * @param options Status mapping inputs and TTL configuration.
 * @returns True when a suppression window was applied.
 */
export function suppressForHttpStatus(options: ProviderHttpSuppressionOptions): boolean {
  const authStatuses = options.authStatuses ?? DEFAULT_AUTH_STATUSES;
  const rateLimitStatuses = options.rateLimitStatuses ?? DEFAULT_RATE_LIMIT_STATUSES;

  if (authStatuses.includes(options.status)) {
    options.suppression.suppress(options.authTtlMs, "auth");
    return true;
  }

  if (rateLimitStatuses.includes(options.status)) {
    options.suppression.suppress(options.rateLimitTtlMs, "rate-limit");
    return true;
  }

  return false;
}

/**
 * Builds a provider URL from a base URL, relative path, and query parameters.
 *
 * @param baseUrl Provider base URL.
 * @param path Relative endpoint path.
 * @param params Query parameter map.
 * @returns Fully hydrated URL instance.
 */
function buildProviderUrl(
  baseUrl: string,
  path: string,
  params: Record<string, QueryParamValue>
): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, normalizedBaseUrl);
  setUrlSearchParams(url, params);
  return url;
}

/**
 * Executes a JSON request for providers that return top-level object payloads
 * and share the same timeout/suppression/logging flow.
 *
 * @param options Request configuration and suppression rules.
 * @returns Parsed object payload or null when the request cannot be used.
 */
export async function fetchJsonRecordWithSuppression(
  options: ProviderJsonRequestOptions
): Promise<Record<string, unknown> | null> {
  if (options.suppression.isSuppressed()) {
    return null;
  }

  const url = buildProviderUrl(options.baseUrl, options.path, options.params ?? {});

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: getFetchSignal(options.timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
        ...options.headers
      }
    });

    if (!response.ok) {
      suppressForHttpStatus({
        status: response.status,
        suppression: options.suppression,
        authTtlMs: options.authTtlMs,
        rateLimitTtlMs: options.rateLimitTtlMs,
        authStatuses: options.authStatuses,
        rateLimitStatuses: options.rateLimitStatuses
      });
      return null;
    }

    const payload = toRecord(await response.json());
    const failure = options.classifyPayloadFailure?.(payload) ?? null;
    if (failure) {
      options.suppression.suppress(failure.ttlMs, failure.label);
      return null;
    }

    return payload;
  } catch (error) {
    log({
      level: "warn",
      service: options.service,
      message: error instanceof Error ? error.message : `Unknown ${options.adapterLabel} error.`
    });
    return null;
  }
}
