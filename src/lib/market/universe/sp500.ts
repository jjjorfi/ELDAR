import { getFinnhubApiKeys } from "@/lib/market/finnhub";
import { normalizeSectorName } from "@/lib/scoring/sector-config";

const WIKIPEDIA_SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const DATAHUB_SP500_CSV_URL = "https://datahub.io/core/s-and-p-500-companies/r/constituents.csv";
const FINNHUB_CONSTITUENTS_URL = "https://finnhub.io/api/v1/index/constituents";

const FALLBACK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK.B", "LLY", "AVGO", "TSLA"];
const KNOWN_BAD_SYMBOLS = new Set(["Q"]);

export interface SP500Constituent {
  symbol: string;
  sector: string;
}

export interface SP500DirectoryEntry {
  symbol: string;
  companyName: string;
  sector: string;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#160;/g, " ").trim();
}

function normalizeSymbol(symbol: string): string {
  return symbol.replace(/\s+/g, "").toUpperCase();
}

function validSymbol(symbol: string): boolean {
  return /^[A-Z.\-]+$/.test(symbol);
}

function isKnownBadSymbol(symbol: string): boolean {
  return KNOWN_BAD_SYMBOLS.has(symbol);
}

function uniqueSorted(symbols: string[]): string[] {
  return Array.from(new Set(symbols)).sort((a, b) => a.localeCompare(b));
}

function parseConstituentsTable(html: string): string[] {
  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i);

  if (!tableMatch) {
    return [];
  }

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const symbols: string[] = [];

  for (const row of rows) {
    const cellMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!cellMatch) continue;

    const raw = stripTags(cellMatch[1]);
    if (!raw) continue;

    const symbol = normalizeSymbol(raw);

    if (!validSymbol(symbol) || isKnownBadSymbol(symbol)) {
      continue;
    }

    symbols.push(symbol);
  }

  return uniqueSorted(symbols);
}

function extractCells(row: string): string[] {
  const matches = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [];
  return matches.map((cell) => {
    const inner = cell.replace(/^<t[dh][^>]*>/i, "").replace(/<\/t[dh]>$/i, "");
    return stripTags(inner);
  });
}

function parseConstituentsWithSectorFromHtml(html: string): SP500Constituent[] {
  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const items: SP500Constituent[] = [];

  for (const row of rows) {
    const cells = extractCells(row);
    if (cells.length < 3) continue;

    const symbol = normalizeSymbol(cells[0] ?? "");
    if (symbol === "SYMBOL") continue;
    if (!validSymbol(symbol) || isKnownBadSymbol(symbol)) continue;

    const normalizedSector = normalizeSectorName(cells[2] ?? "");
    if (normalizedSector === "Other") continue;

    items.push({
      symbol,
      sector: normalizedSector
    });
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.symbol)) return false;
    seen.add(item.symbol);
    return true;
  });
}

async function fetchFromFinnhub(): Promise<string[]> {
  const keys = getFinnhubApiKeys();

  for (const token of keys) {
    try {
      const url = new URL(FINNHUB_CONSTITUENTS_URL);
      url.searchParams.set("symbol", "^GSPC");
      url.searchParams.set("token", token);

      const response = await fetch(url.toString(), {
        next: { revalidate: 86_400 },
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as { constituents?: unknown[] };
      const constituents = Array.isArray(payload.constituents) ? payload.constituents : [];
      const parsed = uniqueSorted(
        constituents
          .filter((item): item is string => typeof item === "string")
          .map((item) => normalizeSymbol(item))
          .filter((item) => validSymbol(item) && !isKnownBadSymbol(item))
      );

      if (parsed.length >= 450) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return [];
}

function parseCsvColumnFirstValue(line: string): string | null {
  if (!line.trim()) return null;

  const firstColumn = line.split(",")[0]?.replace(/^"|"$/g, "").trim();
  if (!firstColumn) return null;

  const symbol = normalizeSymbol(firstColumn);
  return validSymbol(symbol) && !isKnownBadSymbol(symbol) ? symbol : null;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      const next = line[index + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^"|"$/g, "").trim());
}

async function fetchFromDataHub(): Promise<string[]> {
  try {
    const response = await fetch(DATAHUB_SP500_CSV_URL, {
      next: { revalidate: 86_400 },
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      return [];
    }

    const csv = await response.text();
    const lines = csv.split(/\r?\n/).slice(1);
    const symbols: string[] = [];

    for (const line of lines) {
      const symbol = parseCsvColumnFirstValue(line);
      if (symbol) symbols.push(symbol);
    }

    const parsed = uniqueSorted(symbols);
    return parsed.length >= 450 ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchConstituentsWithSectorFromDataHub(): Promise<SP500Constituent[]> {
  try {
    const response = await fetch(DATAHUB_SP500_CSV_URL, {
      next: { revalidate: 86_400 },
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) return [];

    const csv = await response.text();
    const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((item) => item.replace(/^"|"$/g, "").trim().toLowerCase());
    const symbolIndex = headers.findIndex((header) => header === "symbol");
    const sectorIndex = headers.findIndex((header) => header === "sector" || header === "gics sector");

    if (symbolIndex < 0 || sectorIndex < 0) return [];

    const items: SP500Constituent[] = [];

    for (const line of lines.slice(1)) {
      const cols = line.split(",").map((item) => item.replace(/^"|"$/g, "").trim());
      const symbol = normalizeSymbol(cols[symbolIndex] ?? "");
      if (!validSymbol(symbol) || isKnownBadSymbol(symbol)) continue;

      const normalizedSector = normalizeSectorName(cols[sectorIndex] ?? "");
      if (normalizedSector === "Other") continue;

      items.push({
        symbol,
        sector: normalizedSector
      });
    }

    if (items.length < 450) return [];

    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.symbol)) return false;
      seen.add(item.symbol);
      return true;
    });
  } catch {
    return [];
  }
}

let sp500SectorMapCache: Record<string, string> | null = null;
let sp500SectorMapInFlight: Promise<Record<string, string>> | null = null;
let sp500DirectoryCache: Record<string, SP500DirectoryEntry> | null = null;
let sp500DirectoryInFlight: Promise<Record<string, SP500DirectoryEntry>> | null = null;

export async function fetchSP500Symbols(): Promise<string[]> {
  const [finnhubSymbols, datahubSymbols] = await Promise.all([
    fetchFromFinnhub(),
    fetchFromDataHub()
  ]);

  try {
    const response = await fetch(WIKIPEDIA_SP500_URL, {
      next: { revalidate: 86_400 },
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (response.ok) {
      const html = await response.text();
      const parsed = parseConstituentsTable(html);

      if (parsed.length >= 450) {
        if (finnhubSymbols.length >= 450) {
          const wikiSet = new Set(parsed);
          const intersection = uniqueSorted(finnhubSymbols.filter((symbol) => wikiSet.has(symbol)));
          if (intersection.length >= 450) {
            return intersection;
          }
        }
        return parsed;
      }
    }
  } catch {
    // Fall through to DataHub and static fallback.
  }

  if (finnhubSymbols.length >= 450) {
    return finnhubSymbols;
  }

  if (datahubSymbols.length >= 450) {
    return datahubSymbols;
  }

  return FALLBACK_SYMBOLS;
}

export async function fetchSP500SectorMap(): Promise<Record<string, string>> {
  if (sp500SectorMapCache) {
    return sp500SectorMapCache;
  }

  if (sp500SectorMapInFlight) {
    return sp500SectorMapInFlight;
  }

  sp500SectorMapInFlight = (async () => {
    const directory = await fetchSP500Directory();
    const map: Record<string, string> = {};

    for (const [symbol, entry] of Object.entries(directory)) {
      map[symbol] = entry.sector;
    }

    sp500SectorMapCache = map;
    return map;
  })().finally(() => {
    sp500SectorMapInFlight = null;
  });

  return sp500SectorMapInFlight;
}

function parseWikiDirectory(html: string): SP500DirectoryEntry[] {
  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const items: SP500DirectoryEntry[] = [];

  for (const row of rows) {
    const cells = extractCells(row);
    if (cells.length < 3) continue;

    const symbol = normalizeSymbol(cells[0] ?? "");
    if (symbol === "SYMBOL") continue;
    if (!validSymbol(symbol) || isKnownBadSymbol(symbol)) continue;

    const companyName = (cells[1] ?? "").trim() || symbol;
    const sector = normalizeSectorName(cells[2] ?? "");

    items.push({
      symbol,
      companyName,
      sector
    });
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.symbol)) return false;
    seen.add(item.symbol);
    return true;
  });
}

function parseDataHubDirectory(csv: string): SP500DirectoryEntry[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const symbolIndex = headers.findIndex((header) => header === "symbol");
  const nameIndex = headers.findIndex((header) => header === "security" || header === "name");
  const sectorIndex = headers.findIndex((header) => header === "sector" || header === "gics sector");

  if (symbolIndex < 0) return [];

  const items: SP500DirectoryEntry[] = [];

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const symbol = normalizeSymbol(columns[symbolIndex] ?? "");
    if (!validSymbol(symbol) || isKnownBadSymbol(symbol)) continue;

    const companyName = (nameIndex >= 0 ? columns[nameIndex] : "")?.trim() || symbol;
    const sectorRaw = sectorIndex >= 0 ? columns[sectorIndex] : "";
    const sector = normalizeSectorName(sectorRaw);

    items.push({
      symbol,
      companyName,
      sector
    });
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.symbol)) return false;
    seen.add(item.symbol);
    return true;
  });
}

export async function fetchSP500Directory(): Promise<Record<string, SP500DirectoryEntry>> {
  if (sp500DirectoryCache) {
    return sp500DirectoryCache;
  }

  if (sp500DirectoryInFlight) {
    return sp500DirectoryInFlight;
  }

  sp500DirectoryInFlight = (async () => {
    try {
      const wikiResponse = await fetch(WIKIPEDIA_SP500_URL, {
        next: { revalidate: 86_400 },
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      if (wikiResponse.ok) {
        const html = await wikiResponse.text();
        const wikiDirectory = parseWikiDirectory(html);
        if (wikiDirectory.length >= 450) {
          const map = Object.fromEntries(wikiDirectory.map((item) => [item.symbol, item]));
          sp500DirectoryCache = map;
          return map;
        }
      }
    } catch {
      // Fall through.
    }

    try {
      const dataHubResponse = await fetch(DATAHUB_SP500_CSV_URL, {
        next: { revalidate: 86_400 },
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      if (dataHubResponse.ok) {
        const csv = await dataHubResponse.text();
        const dataHubDirectory = parseDataHubDirectory(csv);
        if (dataHubDirectory.length >= 450) {
          const map = Object.fromEntries(dataHubDirectory.map((item) => [item.symbol, item]));
          sp500DirectoryCache = map;
          return map;
        }
      }
    } catch {
      // Fall through.
    }

    const symbols = await fetchSP500Symbols();
    const fallbackItems = symbols.map((symbol) => ({
      symbol,
      companyName: symbol,
      sector: "Other"
    }));
    const fallbackMap = Object.fromEntries(fallbackItems.map((item) => [item.symbol, item]));
    sp500DirectoryCache = fallbackMap;
    return fallbackMap;
  })().finally(() => {
    sp500DirectoryInFlight = null;
  });

  return sp500DirectoryInFlight;
}
