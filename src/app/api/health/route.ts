import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { isAuthorizedAdminRequest } from "@/lib/security/admin";

export const runtime = "nodejs";

type ProviderCheck = {
  ok: boolean;
  status: number | null;
  endpoint: string;
  detail?: string;
  latencyMs: number;
};

function keyExists(value: string): boolean {
  return value.trim().length > 0;
}

function redactProviderEndpoint(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of ["token", "apikey", "apiKey", "api_token"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unknown-endpoint";
  }
}

async function timedFetch(
  url: string,
  includeDetail: boolean,
  timeoutMs = 12_000,
  extraHeaders: Record<string, string> = {}
): Promise<ProviderCheck> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
        ...extraHeaders
      },
      cache: "no-store"
    });

    const elapsed = Date.now() - start;
    const text = await response.text();
    const detail = text.slice(0, 220).replace(/\s+/g, " ").trim();

    return {
      ok: response.ok,
      status: response.status,
      endpoint: redactProviderEndpoint(url),
      detail: includeDetail ? detail : undefined,
      latencyMs: elapsed
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      endpoint: redactProviderEndpoint(url),
      detail: includeDetail ? (error instanceof Error ? error.message : "Unknown fetch error") : undefined,
      latencyMs: Date.now() - start
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sampleSymbol(input: string | null): string {
  if (!input) return "AAPL";
  const normalized = input.trim().toUpperCase();
  return /^[A-Z.\-]{1,12}$/.test(normalized) ? normalized : "AAPL";
}

function toEodhdSymbol(symbol: string): string {
  return symbol.includes(".") ? symbol : `${symbol}.US`;
}

/**
 * Returns service/provider health. Admin callers receive provider-level detail.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-health",
    max: 30,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const includeDetail = isAuthorizedAdminRequest(request);
    const requestUrl = new URL(request.url);
    const symbol = sampleSymbol(requestUrl.searchParams.get("symbol"));

    const alpacaKey = env.ALPACA_API_KEY || env.ALPACA_API_KEY_ID || env.APCA_API_KEY_ID;
    const alpacaSecret = env.ALPACA_API_SECRET || env.ALPACA_SECRET_KEY || env.APCA_API_SECRET_KEY;

    const checks = await Promise.all([
      timedFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, includeDetail),
      timedFetch(
        env.FINNHUB_API_KEY
          ? `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`
          : "https://finnhub.io/api/v1/quote?symbol=AAPL&token=MISSING_KEY",
        includeDetail
      ),
      timedFetch(
        env.ALPHA_VANTAGE_API_KEY
          ? `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(env.ALPHA_VANTAGE_API_KEY)}`
          : "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=MISSING_KEY",
        includeDetail
      ),
      timedFetch(
        env.FMP_API_KEY
          ? `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(env.FMP_API_KEY)}`
          : "https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=MISSING_KEY",
        includeDetail
      ),
      timedFetch(
        env.MASSIVE_API_KEY
          ? `https://api.massive.com/v3/snapshot/options/${encodeURIComponent(symbol)}?contract_type=call&limit=1&apikey=${encodeURIComponent(env.MASSIVE_API_KEY)}&apiKey=${encodeURIComponent(env.MASSIVE_API_KEY)}`
          : "https://api.massive.com/v3/snapshot/options/AAPL?contract_type=call&limit=1&apikey=MISSING_KEY&apiKey=MISSING_KEY",
        includeDetail
      ),
      timedFetch(
        env.EODHD_API_KEY
          ? `https://eodhd.com/api/real-time/${encodeURIComponent(toEodhdSymbol(symbol))}?api_token=${encodeURIComponent(env.EODHD_API_KEY)}&fmt=json`
          : "https://eodhd.com/api/real-time/AAPL.US?api_token=MISSING_KEY&fmt=json",
        includeDetail
      ),
      timedFetch(
        `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars/latest?feed=iex`,
        includeDetail,
        12_000,
        alpacaKey && alpacaSecret
          ? {
              "APCA-API-KEY-ID": alpacaKey,
              "APCA-API-SECRET-KEY": alpacaSecret
            }
          : {}
      )
    ]);

    const [yahoo, finnhub, alpha, fmp, massive, eodhd, alpaca] = checks;
    const providersOk = checks.some((item) => item.ok);

    log({
      level: "info",
      service: "api-health",
      message: "Health check completed",
      includeDetail,
      providersOk,
      durationMs: Date.now() - startedAt
    });

    if (!includeDetail) {
      return okResponse(
        {
          ok: providersOk,
          service: "ELDAR",
          timestamp: new Date().toISOString()
        },
        {
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    return okResponse(
      {
        ok: providersOk,
        service: "ELDAR",
        symbol,
        timestamp: new Date().toISOString(),
        configuredKeys: {
          ALPHA_VANTAGE_API_KEY: keyExists(env.ALPHA_VANTAGE_API_KEY),
          FINNHUB_API_KEY: keyExists(env.FINNHUB_API_KEY),
          FMP_API_KEY: keyExists(env.FMP_API_KEY),
          MASSIVE_API_KEY: keyExists(env.MASSIVE_API_KEY),
          EODHD_API_KEY: keyExists(env.EODHD_API_KEY),
          ALPACA_API_KEY: keyExists(env.ALPACA_API_KEY) || keyExists(env.ALPACA_API_KEY_ID) || keyExists(env.APCA_API_KEY_ID),
          ALPACA_API_SECRET: keyExists(env.ALPACA_API_SECRET) || keyExists(env.ALPACA_SECRET_KEY) || keyExists(env.APCA_API_SECRET_KEY),
          POSTGRES_URL: keyExists(env.POSTGRES_URL)
        },
        providers: {
          yahoo,
          finnhub,
          alphaVantage: alpha,
          financialModelingPrep: fmp,
          massive,
          eodhd,
          alpaca
        }
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    return errorResponse(error, { route: "api-health" }, { "Cache-Control": "no-store" });
  }
}
