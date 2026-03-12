// Lightweight Google News RSS fallback for dashboard market headlines. This is
// not part of scoring and should remain a last-resort continuity source when
// provider-backed news endpoints are empty or rate-limited. It is focused on
// headline retrieval only; do not expand it into a fundamentals adapter.

import { getFetchSignal } from "@/lib/market/adapter-utils";

export interface GoogleNewsHeadline {
  symbol: string | null;
  headline: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
}

const GOOGLE_NEWS_FETCH_TIMEOUT_MS = 4_000;

function decodeXml(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

function splitHeadlineAndSource(rawHeadline: string): { headline: string; source: string | null } {
  const parts = rawHeadline.split(/\s+-\s+/);
  if (parts.length < 2) {
    return { headline: rawHeadline, source: null };
  }

  const source = parts[parts.length - 1]?.trim() || null;
  const headline = parts.slice(0, -1).join(" - ").trim();
  return {
    headline: headline || rawHeadline,
    source
  };
}

function detectSymbol(text: string, focusSymbols: string[]): string | null {
  const upper = text.toUpperCase();
  for (const symbol of focusSymbols) {
    if (upper.includes(symbol)) {
      return symbol;
    }
  }
  return null;
}

async function fetchGoogleNewsSearch(
  query: string,
  focusSymbols: string[],
  limit = 8
): Promise<GoogleNewsHeadline[]> {
  if (!query.trim()) {
    return [];
  }
  const normalizedFocusSymbols = Array.from(new Set(focusSymbols.map((value) => value.trim().toUpperCase()).filter(Boolean))).slice(0, 8);
  const encodedQuery = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const response = await fetch(url, {
      signal: getFetchSignal(GOOGLE_NEWS_FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

    return itemBlocks
      .slice(0, Math.max(limit * 2, 12))
      .map((block) => {
        const rawHeadline = extractTag(block, "title");
        if (!rawHeadline) {
          return null;
        }

        const split = splitHeadlineAndSource(rawHeadline);
        const source = extractTag(block, "source") ?? split.source;
        const publishedAt = extractTag(block, "pubDate");
        const parsedTime = publishedAt ? Date.parse(publishedAt) : NaN;

        return {
          symbol: detectSymbol(split.headline, normalizedFocusSymbols),
          headline: split.headline,
          url: extractTag(block, "link"),
          source,
          publishedAt: Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : null
        } satisfies GoogleNewsHeadline;
      })
      .filter((item): item is GoogleNewsHeadline => item !== null)
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

export async function fetchGoogleNewsHeadlines(
  focusSymbols: string[],
  limit = 8
): Promise<GoogleNewsHeadline[]> {
  const symbols = Array.from(new Set(focusSymbols.map((value) => value.trim().toUpperCase()).filter(Boolean))).slice(0, 6);
  if (symbols.length === 0) {
    return [];
  }

  return fetchGoogleNewsSearch(`${symbols.join(" OR ")} OR S&P 500 when:7d`, symbols, limit);
}

export async function fetchGoogleNewsByQuery(
  query: string,
  focusSymbols: string[] = [],
  limit = 8
): Promise<GoogleNewsHeadline[]> {
  return fetchGoogleNewsSearch(`${query} when:7d`, focusSymbols, limit);
}
