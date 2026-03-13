// This file adds Google Finance page scraping as a temporary quote fallback.
// Google Finance does not expose an official public API for this use case, so
// this adapter is intentionally low-rank and limited to quote continuity only.
// Gotcha: keep this below official provider APIs in fallback order and remove
// it once premium market-data providers are upgraded.

import { getFetchSignal, parseOptionalNumber } from "@/lib/market/adapter-utils";
import { log } from "@/lib/logger";

export interface GoogleFinanceQuoteSnapshot {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
  exchange: string | null;
  sourceUrl: string | null;
}

const GOOGLE_FINANCE_BASE_URL = "https://www.google.com/finance/quote";
const GOOGLE_FINANCE_FETCH_TIMEOUT_MS = 1_800;
const GOOGLE_FINANCE_DISABLE_TTL_MS = 5 * 60_000;
const GOOGLE_FINANCE_WARN_TTL_MS = 60_000;
const GOOGLE_FINANCE_CACHE_TTL_MS = 60_000;

let googleFinanceDisabledUntil = 0;
let googleFinanceWarnedAt = 0;
let googleFinanceCache = new Map<string, { expiresAt: number; snapshot: GoogleFinanceQuoteSnapshot }>();
let googleFinanceInFlight = new Map<string, Promise<GoogleFinanceQuoteSnapshot>>();

function warnOnce(message: string): void {
  if (Date.now() - googleFinanceWarnedAt < GOOGLE_FINANCE_WARN_TTL_MS) {
    return;
  }
  googleFinanceWarnedAt = Date.now();
  log({
    level: "warn",
    service: "provider-google-finance",
    message
  });
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  return parseOptionalNumber(value, { allowCommas: true, allowPercent: true });
}

function pageCandidates(symbol: string): Array<{ path: string; exchange: string | null }> {
  const upper = symbol.trim().toUpperCase();

  if (upper === "^GSPC") return [{ path: ".INX:INDEXSP", exchange: "INDEXSP" }];
  if (upper === "^NDX") return [{ path: ".IXIC:INDEXNASDAQ", exchange: "INDEXNASDAQ" }];
  if (upper === "^VIX") return [];
  if (upper === "^RUT") return [{ path: "RUT:INDEXRUSSELL", exchange: "INDEXRUSSELL" }];
  if (upper.endsWith("=F")) return [];

  return [
    { path: `${upper}:NASDAQ`, exchange: "NASDAQ" },
    { path: `${upper}:NYSE`, exchange: "NYSE" },
    { path: `${upper}:NYSEARCA`, exchange: "NYSEARCA" },
    { path: `${upper}:NYSEAMERICAN`, exchange: "NYSEAMERICAN" }
  ];
}

function quoteBlock(html: string): string {
  const anchor = html.indexOf("data-last-price=");
  if (anchor === -1) {
    return html.slice(0, 3000);
  }
  return html.slice(anchor, anchor + 2500);
}

function extractChangePercent(html: string): number | null {
  const scopedHtml = quoteBlock(html);
  const ariaMatch = /aria-label="(Down|Up) by ([0-9.,]+)%"/i.exec(scopedHtml);
  if (ariaMatch) {
    const magnitude = parseNumber(ariaMatch[2]);
    if (magnitude === null) return null;
    return ariaMatch[1].toLowerCase() === "down" ? -Math.abs(magnitude) : Math.abs(magnitude);
  }

  const dataPercentMatch = /data-percent="(-?[0-9.,]+)"/i.exec(scopedHtml);
  if (dataPercentMatch) {
    return parseNumber(dataPercentMatch[1]);
  }

  return null;
}

function extractSnapshot(html: string, sourceUrl: string): GoogleFinanceQuoteSnapshot {
  const price = parseNumber(/data-last-price="([^"]+)"/i.exec(html)?.[1]);
  const asOfSeconds = parseNumber(/data-last-normal-market-timestamp="([^"]+)"/i.exec(html)?.[1]);
  const exchange = /data-exchange="([^"]+)"/i.exec(html)?.[1] ?? null;

  return {
    price,
    changePercent: extractChangePercent(html),
    asOfMs: asOfSeconds !== null ? Math.round(asOfSeconds * 1000) : null,
    exchange,
    sourceUrl
  };
}

export async function fetchGoogleFinanceQuoteSnapshot(symbol: string): Promise<GoogleFinanceQuoteSnapshot> {
  const cacheKey = symbol.trim().toUpperCase();
  const cached = googleFinanceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  if (Date.now() < googleFinanceDisabledUntil) {
    return {
      price: null,
      changePercent: null,
      asOfMs: null,
      exchange: null,
      sourceUrl: null
    };
  }

  let inFlight = googleFinanceInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = (async () => {
      for (const candidate of pageCandidates(symbol)) {
        const url = `${GOOGLE_FINANCE_BASE_URL}/${encodeURIComponent(candidate.path)}`;

        try {
          const response = await fetch(url, {
            cache: "no-store",
            signal: getFetchSignal(GOOGLE_FINANCE_FETCH_TIMEOUT_MS),
            headers: {
              Accept: "text/html",
              "User-Agent": "Mozilla/5.0"
            }
          });

          if (!response.ok) {
            if (response.status === 401 || response.status === 403 || response.status === 429) {
              googleFinanceDisabledUntil = Date.now() + GOOGLE_FINANCE_DISABLE_TTL_MS;
              warnOnce(`temporary suppression after HTTP ${response.status}.`);
              break;
            }
            continue;
          }

          const html = await response.text();
          const snapshot = extractSnapshot(html, url);
          if (snapshot.price !== null) {
            googleFinanceCache.set(cacheKey, {
              expiresAt: Date.now() + GOOGLE_FINANCE_CACHE_TTL_MS,
              snapshot
            });
            return snapshot;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown Google Finance error.";
          warnOnce(message);
        }
      }

      return {
        price: null,
        changePercent: null,
        asOfMs: null,
        exchange: null,
        sourceUrl: null
      };
    })();
    googleFinanceInFlight.set(cacheKey, inFlight);
  }

  try {
    return await inFlight;
  } finally {
    googleFinanceInFlight.delete(cacheKey);
  }
}
