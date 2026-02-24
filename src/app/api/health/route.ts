import { NextResponse } from "next/server";

import { isAuthorizedAdminRequest } from "@/lib/security/admin";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

interface ProviderCheck {
  ok: boolean;
  status: number | null;
  endpoint: string;
  detail?: string;
  latencyMs: number;
}

function keyExists(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
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

async function timedFetch(url: string, includeDetail: boolean, timeoutMs = 12_000): Promise<ProviderCheck> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0"
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
    const elapsed = Date.now() - start;
    return {
      ok: false,
      status: null,
      endpoint: redactProviderEndpoint(url),
      detail: includeDetail ? (error instanceof Error ? error.message : "Unknown fetch error") : undefined,
      latencyMs: elapsed
    };
  } finally {
    clearTimeout(timeout);
  }
}

function safeToken(token: string | undefined): string | null {
  if (!token) return null;
  const value = token.trim();
  if (!value) return null;
  return value;
}

function sampleSymbol(input: string | null): string {
  if (!input) return "AAPL";
  const normalized = input.trim().toUpperCase();
  return /^[A-Z.\-]{1,12}$/.test(normalized) ? normalized : "AAPL";
}

function toEodhdSymbol(symbol: string): string {
  return symbol.includes(".") ? symbol : `${symbol}.US`;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: in production this locks /api/health behind admin auth.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  const throttled = enforceRateLimit(request, {
    bucket: "api-health",
    max: 30,
    windowMs: 60_000
  });
  if (throttled) return throttled;

  const includeDetail = isAuthorizedAdminRequest(request);
  const requestUrl = new URL(request.url);
  const symbol = sampleSymbol(requestUrl.searchParams.get("symbol"));

  const finnhubKey = safeToken(process.env.FINNHUB_API_KEY);
  const alphaKey = safeToken(process.env.ALPHA_VANTAGE_API_KEY);
  const fmpKey = safeToken(process.env.FMP_API_KEY);
  const massiveKey = safeToken(process.env.MASSIVE_API_KEY);
  const eodhdKey = safeToken(process.env.EODHD_API_KEY);

  const checks = await Promise.all([
    timedFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, includeDetail),
    timedFetch(
      finnhubKey
        ? `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(finnhubKey)}`
        : "https://finnhub.io/api/v1/quote?symbol=AAPL&token=MISSING_KEY",
      includeDetail
    ),
    timedFetch(
      alphaKey
        ? `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(alphaKey)}`
        : "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=MISSING_KEY",
      includeDetail
    ),
    timedFetch(
      fmpKey
        ? `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(fmpKey)}`
        : "https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=MISSING_KEY",
      includeDetail
    ),
    timedFetch(
      massiveKey
        ? `https://api.massive.com/v3/snapshot/options/${encodeURIComponent(symbol)}?contract_type=call&limit=1&apikey=${encodeURIComponent(massiveKey)}&apiKey=${encodeURIComponent(massiveKey)}`
        : "https://api.massive.com/v3/snapshot/options/AAPL?contract_type=call&limit=1&apikey=MISSING_KEY&apiKey=MISSING_KEY",
      includeDetail
    ),
    timedFetch(
      eodhdKey
        ? `https://eodhd.com/api/real-time/${encodeURIComponent(toEodhdSymbol(symbol))}?api_token=${encodeURIComponent(eodhdKey)}&fmt=json`
        : "https://eodhd.com/api/real-time/AAPL.US?api_token=MISSING_KEY&fmt=json",
      includeDetail
    )
  ]);

  const [yahoo, finnhub, alpha, fmp, massive, eodhd] = checks;
  const providersOk = checks.some((item) => item.ok);

  if (!includeDetail) {
    return NextResponse.json(
      {
        ok: providersOk,
        service: "ELDAR",
        timestamp: new Date().toISOString()
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  return NextResponse.json({
    ok: providersOk,
    service: "ELDAR",
    symbol,
    timestamp: new Date().toISOString(),
    configuredKeys: {
      ALPHA_VANTAGE_API_KEY: keyExists("ALPHA_VANTAGE_API_KEY"),
      FINNHUB_API_KEY: keyExists("FINNHUB_API_KEY"),
      FMP_API_KEY: keyExists("FMP_API_KEY"),
      MASSIVE_API_KEY: keyExists("MASSIVE_API_KEY"),
      EODHD_API_KEY: keyExists("EODHD_API_KEY"),
      POSTGRES_URL: keyExists("POSTGRES_URL")
    },
    providers: {
      yahoo,
      finnhub,
      alphaVantage: alpha,
      financialModelingPrep: fmp,
      massive,
      eodhd
    }
  }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
