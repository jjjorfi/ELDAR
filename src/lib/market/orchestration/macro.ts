import { env } from "@/lib/env";

interface MacroSignals {
  fedSignal: "DOVISH" | "HAWKISH" | "UNCHANGED" | "UNKNOWN";
  fedDelta: number | null;
  fedCutProbability: number | null;
  fedHoldProbability: number | null;
  fedHikeProbability: number | null;
  fedNextMeetingDate: string | null;
  fedOddsSource: string | null;
  vixLevel: number | null;
  marketPutCallRatio: number | null;
  gdpSurprise: number | null;
}

const GDP_CALENDAR_URL = "https://api.tradingeconomics.com/calendar/country/united%20states?c=guest:guest&f=json";
const GDP_GROWTH_SERIES_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=A191RL1Q225SBEA";
const VIX_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=5d&interval=1d";
const CBOE_PCR_DAILY_URL = "https://cdn.cboe.com/data/us/options/market_statistics/daily_put_call_ratios.csv";

const FEDWATCH_ENDPOINTS = [
  "https://www.cmegroup.com/CmeWS/mvc/FedWatchTool/AllMeetings",
  "https://www.cmegroup.com/CmeWS/mvc/FedWatchTool/AllMeetings?isProtected=true",
  "https://www.cmegroup.com/CmeWS/mvc/FedWatchTool/FOMCMeetings"
];

interface FedOddsSnapshot {
  fedSignal: MacroSignals["fedSignal"];
  fedDelta: number | null;
  fedCutProbability: number | null;
  fedHoldProbability: number | null;
  fedHikeProbability: number | null;
  fedNextMeetingDate: string | null;
  fedOddsSource: string | null;
}

function parsePercentValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(raw.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProbability(raw: unknown): number | null {
  const asPercent = parsePercentValue(raw);

  if (asPercent === null) {
    return null;
  }

  if (asPercent < 0) {
    return null;
  }

  const normalized = asPercent > 1 ? asPercent / 100 : asPercent;

  if (!Number.isFinite(normalized)) {
    return null;
  }

  return Math.max(0, Math.min(1, normalized));
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function toIsoDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date && Number.isFinite(+raw)) {
    return raw.toISOString();
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Unix seconds or milliseconds.
    const ms = raw > 2_000_000_000 ? raw : raw * 1000;
    const date = new Date(ms);
    return Number.isFinite(+date) ? date.toISOString() : null;
  }

  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return null;

    const parsed = new Date(value);
    return Number.isFinite(+parsed) ? parsed.toISOString() : null;
  }

  return null;
}

function walkUnknown(value: unknown, visit: (key: string, child: unknown) => void, depth = 0): void {
  if (depth > 6) return;

  if (Array.isArray(value)) {
    for (const child of value) {
      walkUnknown(child, visit, depth + 1);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walkUnknown(child, visit, depth + 1);
  }
}

function collectObjects(value: unknown, output: Array<Record<string, unknown>>, depth = 0): void {
  if (depth > 6) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, output, depth + 1);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  output.push(value as Record<string, unknown>);

  for (const nested of Object.values(value)) {
    collectObjects(nested, output, depth + 1);
  }
}

function findMeetingDate(value: unknown): string | null {
  let found: string | null = null;

  walkUnknown(value, (key, child) => {
    if (found) return;

    const normalized = normalizeKey(key);
    if (!normalized.includes("date") && !normalized.includes("meeting")) {
      return;
    }

    const parsed = toIsoDate(child);
    if (parsed) {
      found = parsed;
    }
  });

  return found;
}

function findActionProbability(value: unknown, actionAliases: string[]): number | null {
  let found: number | null = null;

  walkUnknown(value, (key, child) => {
    if (found !== null) return;

    const normalized = normalizeKey(key);
    const actionMatch = actionAliases.some((alias) => normalized.includes(alias));
    const probabilityHint =
      normalized.includes("prob") ||
      normalized.includes("odds") ||
      normalized.includes("chance") ||
      normalized.includes("likelihood") ||
      normalized.includes("percent") ||
      normalized.endsWith("pct");
    const directActionKey = actionAliases.some(
      (alias) => normalized === alias || normalized.startsWith(alias) || normalized.endsWith(alias)
    );

    if (!actionMatch) {
      return;
    }

    const parsed = parseProbability(child);
    if (parsed === null) {
      return;
    }

    // Avoid misreading non-probability action fields unless key clearly signals probability.
    if (!probabilityHint && !directActionKey && parsed > 0.05) {
      return;
    }

    found = parsed;
  });

  return found;
}

function normalizeTriplet(
  cut: number | null,
  hold: number | null,
  hike: number | null
): { cut: number | null; hold: number | null; hike: number | null } {
  let nextCut = cut;
  let nextHold = hold;
  let nextHike = hike;

  const known = [nextCut, nextHold, nextHike].filter((value): value is number => value !== null);

  if (known.length === 2) {
    const missing = Math.max(0, 1 - known[0] - known[1]);
    if (nextCut === null) nextCut = missing;
    if (nextHold === null) nextHold = missing;
    if (nextHike === null) nextHike = missing;
  }

  if (nextCut !== null && nextHold !== null && nextHike !== null) {
    const total = nextCut + nextHold + nextHike;

    if (total > 0 && Math.abs(total - 1) > 0.03) {
      nextCut /= total;
      nextHold /= total;
      nextHike /= total;
    }
  }

  return { cut: nextCut, hold: nextHold, hike: nextHike };
}

function toFedSignal(cut: number | null, hold: number | null, hike: number | null): MacroSignals["fedSignal"] {
  if (cut === null && hold === null && hike === null) {
    return "UNKNOWN";
  }

  const supportive = (cut ?? 0) + (hold ?? 0);

  if (supportive >= 0.6) {
    return "DOVISH";
  }

  if ((hike ?? 0) >= 0.55) {
    return "HAWKISH";
  }

  return "UNCHANGED";
}

function buildFedOddsSnapshot(
  cut: number | null,
  hold: number | null,
  hike: number | null,
  meetingDate: string | null,
  source: string | null
): FedOddsSnapshot {
  const normalized = normalizeTriplet(cut, hold, hike);
  const supportive = (normalized.cut ?? 0) + (normalized.hold ?? 0);
  const hawkish = normalized.hike ?? 0;
  const hasAny = normalized.cut !== null || normalized.hold !== null || normalized.hike !== null;

  return {
    fedSignal: toFedSignal(normalized.cut, normalized.hold, normalized.hike),
    fedDelta: hasAny ? supportive - hawkish : null,
    fedCutProbability: normalized.cut,
    fedHoldProbability: normalized.hold,
    fedHikeProbability: normalized.hike,
    fedNextMeetingDate: meetingDate,
    fedOddsSource: source
  };
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to recover JSON snippets embedded in wrappers.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // Continue.
    }
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const slice = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }

  return null;
}

function parseFedOddsFromPayload(payload: unknown): FedOddsSnapshot | null {
  const objects: Array<Record<string, unknown>> = [];
  collectObjects(payload, objects);

  const cutAliases = ["cut", "decrease", "lower", "ease", "dovish"];
  const holdAliases = ["hold", "unchanged", "nochange", "steady", "maintain"];
  const hikeAliases = ["hike", "increase", "raise", "tighten", "hawkish"];

  const candidates = objects
    .map((object) => {
      const cut = findActionProbability(object, cutAliases);
      const hold = findActionProbability(object, holdAliases);
      const hike = findActionProbability(object, hikeAliases);
      const date = findMeetingDate(object);
      const hasOdds = cut !== null || hold !== null || hike !== null;

      return { cut, hold, hike, date, hasOdds };
    })
    .filter((candidate) => candidate.hasOdds);

  if (candidates.length === 0) {
    return null;
  }

  const now = Date.now();
  const upcoming = candidates
    .filter((candidate) => {
      if (!candidate.date) return false;
      const date = new Date(candidate.date);
      return Number.isFinite(+date) && +date >= now - 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => +new Date(a.date ?? 0) - +new Date(b.date ?? 0));

  const picked = upcoming[0] ?? candidates[0];

  return buildFedOddsSnapshot(picked.cut, picked.hold, picked.hike, picked.date ?? null, "CME FedWatch");
}

async function fetchFedOddsFromCme(): Promise<FedOddsSnapshot | null> {
  for (const endpoint of FEDWATCH_ENDPOINTS) {
    const url = endpoint.includes("_t=") ? endpoint : `${endpoint}${endpoint.includes("?") ? "&" : "?"}_t=${Date.now()}`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0"
        },
        next: { revalidate: 900 }
      });

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      const payload = tryParseJson(text);
      if (!payload) {
        continue;
      }

      const parsed = parseFedOddsFromPayload(payload);
      if (parsed) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchFedOddsFromTradingEconomics(): Promise<FedOddsSnapshot | null> {
  try {
    const response = await fetch(GDP_CALENDAR_URL, { next: { revalidate: 21_600 } });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Array<Record<string, unknown>>;

    const rateEvents = payload
      .filter((item) => {
        const category = String(item.Category ?? "").toLowerCase();
        const event = String(item.Event ?? "").toLowerCase();
        return category.includes("interest rate") || event.includes("interest rate decision");
      })
      .map((item) => ({
        date: toIsoDate(item.Date),
        forecast: parsePercentValue(item.Forecast ?? item.Consensus ?? item.TEForecast),
        previous: parsePercentValue(item.Previous),
        actual: parsePercentValue(item.Actual)
      }))
      .filter((item) => item.date !== null)
      .sort((a, b) => +new Date(a.date ?? 0) - +new Date(b.date ?? 0));

    if (rateEvents.length === 0) {
      return null;
    }

    const now = Date.now();
    const nextMeeting =
      rateEvents.find((item) => +new Date(item.date ?? 0) >= now - 24 * 60 * 60 * 1000) ??
      rateEvents[rateEvents.length - 1];

    const referenceRate =
      nextMeeting.previous ??
      rateEvents
        .slice()
        .reverse()
        .find((item) => item.actual !== null)?.actual ??
      null;

    const expectedRate = nextMeeting.forecast ?? nextMeeting.actual;

    if (referenceRate === null || expectedRate === null) {
      return null;
    }

    const delta = expectedRate - referenceRate;

    if (delta <= -0.1) {
      return buildFedOddsSnapshot(0.7, 0.25, 0.05, nextMeeting.date, "TradingEconomics forecast *");
    }

    if (delta >= 0.1) {
      return buildFedOddsSnapshot(0.05, 0.25, 0.7, nextMeeting.date, "TradingEconomics forecast *");
    }

    return buildFedOddsSnapshot(0.15, 0.7, 0.15, nextMeeting.date, "TradingEconomics forecast *");
  } catch {
    return null;
  }
}

async function fetchFedOddsSignal(): Promise<FedOddsSnapshot> {
  const cmeOdds = await fetchFedOddsFromCme();
  if (cmeOdds) {
    return cmeOdds;
  }

  const teProxyOdds = await fetchFedOddsFromTradingEconomics();
  if (teProxyOdds) {
    return teProxyOdds;
  }

  return buildFedOddsSnapshot(null, null, null, null, null);
}

async function fetchGdpSurprise(): Promise<number | null> {
  try {
    const response = await fetch(GDP_CALENDAR_URL, { next: { revalidate: 21_600 } });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Array<Record<string, unknown>>;

    const latestGdpEvent = payload
      .filter((item) => {
        const category = String(item.Category ?? "").toLowerCase();
        return category.includes("gdp") && category.includes("growth");
      })
      .map((item) => {
        const actual = parsePercentValue(item.Actual);
        const forecast = parsePercentValue(item.Forecast);
        const dateRaw = item.Date;
        const date = typeof dateRaw === "string" ? new Date(dateRaw) : new Date(0);

        return {
          actual,
          forecast,
          date
        };
      })
      .filter((item) => item.actual !== null && item.forecast !== null && !Number.isNaN(+item.date))
      .sort((a, b) => +b.date - +a.date)[0];

    if (!latestGdpEvent || latestGdpEvent.actual === null || latestGdpEvent.forecast === null) {
      return fetchGdpSurpriseFromFred();
    }

    return latestGdpEvent.actual - latestGdpEvent.forecast;
  } catch {
    return fetchGdpSurpriseFromFred();
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

async function fetchGdpSurpriseFromFred(): Promise<number | null> {
  const apiKey = env.FRED_API_KEY;

  if (apiKey) {
    try {
      const apiUrl = new URL("https://api.stlouisfed.org/fred/series/observations");
      apiUrl.searchParams.set("series_id", "A191RL1Q225SBEA");
      apiUrl.searchParams.set("api_key", apiKey);
      apiUrl.searchParams.set("file_type", "json");
      apiUrl.searchParams.set("sort_order", "asc");

      const response = await fetch(apiUrl.toString(), { next: { revalidate: 21_600 } });
      if (response.ok) {
        const payload = (await response.json()) as {
          observations?: Array<{
            date?: string;
            value?: string;
          }>;
        };
        const values = (payload.observations ?? [])
          .map((row) => {
            if (!row.date || !row.value || row.value === ".") return null;
            const numeric = Number.parseFloat(row.value);
            if (!Number.isFinite(numeric)) return null;
            const date = new Date(row.date);
            if (!Number.isFinite(+date)) return null;
            return { date, value: numeric };
          })
          .filter((item): item is { date: Date; value: number } => item !== null)
          .sort((a, b) => +a.date - +b.date);

        if (values.length >= 6) {
          const latest = values[values.length - 1].value;
          const trailing = values.slice(-9, -1).map((item) => item.value);
          if (trailing.length >= 3) {
            const consensusProxy = median(trailing);
            return latest - consensusProxy;
          }
        }
      }
    } catch {
      // Fall back to fredgraph CSV below.
    }
  }

  try {
    const response = await fetch(GDP_GROWTH_SERIES_URL, { next: { revalidate: 21_600 } });

    if (!response.ok) {
      return null;
    }

    const csv = await response.text();
    const lines = csv.split("\n").slice(1);
    const values = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [date, value] = line.split(",");
        if (!date || !value || value === ".") return null;
        const numeric = Number.parseFloat(value);
        if (!Number.isFinite(numeric)) return null;
        return { date: new Date(date), value: numeric };
      })
      .filter((item): item is { date: Date; value: number } => item !== null)
      .sort((a, b) => +a.date - +b.date);

    if (values.length < 6) {
      return null;
    }

    const latest = values[values.length - 1].value;
    const trailing = values.slice(-9, -1).map((item) => item.value);

    if (trailing.length < 3) {
      return null;
    }

    const consensusProxy = median(trailing);
    return latest - consensusProxy;
  } catch {
    return null;
  }
}

async function fetchVixLevel(): Promise<number | null> {
  try {
    const response = await fetch(VIX_CHART_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      next: { revalidate: 300 }
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const closes = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    for (let index = closes.length - 1; index >= 0; index -= 1) {
      const value = closes[index];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchMarketPutCallRatio(): Promise<number | null> {
  try {
    const response = await fetch(CBOE_PCR_DAILY_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      next: { revalidate: 1800 }
    });

    if (!response.ok) {
      return null;
    }

    const csv = await response.text();
    const lines = csv
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return null;
    }

    const header = lines[0].toLowerCase();
    const ratioIndex = header.split(",").findIndex((column) => column.includes("total") && column.includes("put/call"));
    const fallbackIndex = header.split(",").findIndex((column) => column.includes("put/call"));

    const index = ratioIndex !== -1 ? ratioIndex : fallbackIndex;
    if (index === -1) {
      return null;
    }

    for (let lineIndex = lines.length - 1; lineIndex >= 1; lineIndex -= 1) {
      const columns = lines[lineIndex].split(",").map((column) => column.replaceAll('"', "").trim());
      if (columns.length <= index) continue;
      const raw = columns[index];
      const value = Number.parseFloat(raw);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchMacroSignals(): Promise<MacroSignals> {
  const [fedOdds, gdpSurprise, vixLevel, marketPutCallRatio] = await Promise.all([
    fetchFedOddsSignal(),
    fetchGdpSurprise(),
    fetchVixLevel(),
    fetchMarketPutCallRatio()
  ]);

  return {
    fedSignal: fedOdds.fedSignal,
    fedDelta: fedOdds.fedDelta,
    fedCutProbability: fedOdds.fedCutProbability,
    fedHoldProbability: fedOdds.fedHoldProbability,
    fedHikeProbability: fedOdds.fedHikeProbability,
    fedNextMeetingDate: fedOdds.fedNextMeetingDate,
    fedOddsSource: fedOdds.fedOddsSource,
    vixLevel,
    marketPutCallRatio,
    gdpSurprise
  };
}
