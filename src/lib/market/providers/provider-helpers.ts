import { log } from "@/lib/logger";

/**
 * Shared options for provider suppression state.
 */
export interface ProviderSuppressionOptions {
  adapterLabel: string;
  formatMessage?: (label: string, ttlMs: number) => string;
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
