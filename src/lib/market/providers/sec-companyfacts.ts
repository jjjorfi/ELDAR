// Temporary free-tier fundamentals bridge.
//
// This adapter exists to recover real revenue / EPS / cash-flow-derived
// fundamentals for U.S. issuers while premium fundamentals coverage is not yet
// enabled. It should be demoted or removed once paid provider coverage is
// stable enough to supply these fields directly and uniformly.

interface SecFactRow {
  start?: string;
  end?: string;
  val?: number;
  form?: string;
  fp?: string;
  filed?: string;
  frame?: string;
}

interface SecCompanyFactsResponse {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, SecFactRow[]> }>;
  };
}

export interface SecFundamentalsFallback {
  revenueGrowth: number | null;
  earningsQuarterlyGrowth: number | null;
  ttmFreeCashflow: number | null;
  trailingEpsTtm: number | null;
  sharesOutstanding: number | null;
}

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts";
const SEC_HEADERS = {
  "User-Agent": "ELDAR admin@eldar.app",
  Accept: "application/json"
} as const;
const SEC_REVALIDATE_SECONDS = 21_600;

let tickerMapPromise: Promise<Map<string, string>> | null = null;
const factsPromiseBySymbol = new Map<string, Promise<SecFundamentalsFallback>>();

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, "-");
}

function durationDays(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return Math.round((endMs - startMs) / 86_400_000);
}

function pickUnitRows(
  facts: Record<string, { units?: Record<string, SecFactRow[]> }> | undefined,
  tags: string[],
  preferredUnits: string[]
): SecFactRow[] {
  for (const tag of tags) {
    const fact = facts?.[tag];
    if (!fact?.units) continue;
    for (const unit of preferredUnits) {
      const rows = fact.units[unit];
      if (Array.isArray(rows) && rows.length > 0) {
        return rows;
      }
    }
  }

  return [];
}

function normalizeSeries(rows: SecFactRow[], kind: "quarter" | "annual"): SecFactRow[] {
  const forms = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);
  const filtered = rows.filter((row) => {
    if (typeof row.val !== "number" || !Number.isFinite(row.val)) return false;
    if (row.form && !forms.has(row.form)) return false;

    const days = durationDays(row.start, row.end);
    if (kind === "quarter") {
      return (typeof row.fp === "string" && row.fp.startsWith("Q")) || (days !== null && days >= 70 && days <= 110);
    }

    return row.fp === "FY" || (days !== null && days >= 330 && days <= 380);
  });

  const deduped = new Map<string, SecFactRow>();
  for (const row of filtered) {
    if (!row.end) continue;
    const existing = deduped.get(row.end);
    if (!existing) {
      deduped.set(row.end, row);
      continue;
    }

    const existingFiled = existing.filed ? Date.parse(existing.filed) : 0;
    const nextFiled = row.filed ? Date.parse(row.filed) : 0;
    if (nextFiled >= existingFiled) {
      deduped.set(row.end, row);
    }
  }

  return [...deduped.values()].sort((left, right) => Date.parse(left.end ?? "") - Date.parse(right.end ?? ""));
}

function latestFiledRow(rows: SecFactRow[]): SecFactRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((left, right) => {
    const leftFiled = left.filed ? Date.parse(left.filed) : 0;
    const rightFiled = right.filed ? Date.parse(right.filed) : 0;
    return rightFiled - leftFiled;
  })[0] ?? null;
}

function hasQuarterLikeFrame(frame: string | undefined): boolean {
  if (typeof frame !== "string" || frame.length === 0) return false;
  return /Q[1-4]$/i.test(frame);
}

function normalizeQuarterSeries(rows: SecFactRow[]): SecFactRow[] {
  const forms = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);
  const filtered = rows.filter((row) => {
    if (typeof row.val !== "number" || !Number.isFinite(row.val)) return false;
    if (row.form && !forms.has(row.form)) return false;
    const days = durationDays(row.start, row.end);
    return (
      row.fp === "Q1" ||
      row.fp === "Q2" ||
      row.fp === "Q3" ||
      row.fp === "FY" ||
      (days !== null && days >= 70 && days <= 110) ||
      (days !== null && days >= 330 && days <= 380)
    );
  });

  const rowsByEnd = new Map<string, SecFactRow[]>();
  for (const row of filtered) {
    if (!row.end) continue;
    const bucket = rowsByEnd.get(row.end) ?? [];
    bucket.push(row);
    rowsByEnd.set(row.end, bucket);
  }

  const selected = [...rowsByEnd.entries()]
    .map(([, bucket]) => {
      const discreteFrameQuarter = bucket.filter(
        (row) => hasQuarterLikeFrame(row.frame)
      );
      if (discreteFrameQuarter.length > 0) {
        return latestFiledRow(discreteFrameQuarter);
      }
      const preferred = bucket.filter((row) => row.fp === "Q1" || row.fp === "Q2" || row.fp === "Q3" || row.fp === "FY");
      return latestFiledRow(preferred.length > 0 ? preferred : bucket);
    })
    .filter((row): row is SecFactRow => row !== null)
    .sort((left, right) => Date.parse(left.end ?? "") - Date.parse(right.end ?? ""));

  const cumulativeRows = filtered
    .filter((row) => !row.frame && (row.fp === "Q1" || row.fp === "Q2" || row.fp === "Q3" || row.fp === "FY"))
    .sort((left, right) => Date.parse(left.end ?? "") - Date.parse(right.end ?? ""));

  const findPriorCumulative = (row: SecFactRow): SecFactRow | null => {
    if (!row.start || !row.end) return null;
    const candidates = cumulativeRows.filter(
      (candidate) =>
        candidate !== row &&
        candidate.start === row.start &&
        typeof candidate.end === "string" &&
        Date.parse(candidate.end ?? "") < Date.parse(row.end ?? "")
    );
    return latestFiledRow(
      candidates.sort((left, right) => Date.parse(right.end ?? "") - Date.parse(left.end ?? ""))
    );
  };

  const discreteRows: SecFactRow[] = [];
  for (const row of selected) {
    if (typeof row.val !== "number" || !Number.isFinite(row.val) || !row.end) continue;

    if (hasQuarterLikeFrame(row.frame)) {
      discreteRows.push(row);
      continue;
    }

    if (row.fp === "Q1") {
      discreteRows.push(row);
      continue;
    }

    if (row.fp === "Q2" || row.fp === "Q3" || row.fp === "FY") {
      const prior = findPriorCumulative(row);
      if (prior && typeof prior.val === "number" && Number.isFinite(prior.val)) {
        discreteRows.push({
          ...row,
          start: prior.end ?? row.start,
          val: row.val - prior.val
        });
      }
    }
  }

  const deduped = new Map<string, SecFactRow>();
  for (const row of discreteRows) {
    if (!row.end) continue;
    const existing = deduped.get(row.end);
    if (!existing) {
      deduped.set(row.end, row);
      continue;
    }
    const preferred = latestFiledRow([existing, row]);
    if (preferred) {
      deduped.set(row.end, preferred);
    }
  }

  return [...deduped.values()].sort((left, right) => Date.parse(left.end ?? "") - Date.parse(right.end ?? ""));
}

function latestYoYGrowth(quarterly: SecFactRow[], annual: SecFactRow[]): number | null {
  if (quarterly.length >= 5) {
    const latest = quarterly.at(-1);
    const priorYear = quarterly.at(-5);
    if (
      typeof latest?.val === "number"
      && typeof priorYear?.val === "number"
      && latest.val > 0
      && priorYear.val > 0
      && Math.abs(priorYear.val) > 0.000001
    ) {
      return latest.val / priorYear.val - 1;
    }
  }

  if (annual.length >= 2) {
    const latest = annual.at(-1);
    const prior = annual.at(-2);
    if (
      typeof latest?.val === "number"
      && typeof prior?.val === "number"
      && latest.val > 0
      && prior.val > 0
      && Math.abs(prior.val) > 0.000001
    ) {
      return latest.val / prior.val - 1;
    }
  }

  return null;
}

function trailingTwelveMonths(quarterly: SecFactRow[], annual: SecFactRow[]): number | null {
  if (quarterly.length >= 4) {
    const recent = quarterly.slice(-4);
    return recent.reduce((sum, row) => sum + (row.val ?? 0), 0);
  }

  const latestAnnual = annual.at(-1)?.val;
  return typeof latestAnnual === "number" && Number.isFinite(latestAnnual) ? latestAnnual : null;
}

async function fetchTickerMap(): Promise<Map<string, string>> {
  if (!tickerMapPromise) {
    tickerMapPromise = (async () => {
      const response = await fetch(SEC_TICKERS_URL, {
        headers: SEC_HEADERS,
        next: { revalidate: SEC_REVALIDATE_SECONDS }
      });
      if (!response.ok) {
        throw new Error(`SEC ticker map failed (${response.status})`);
      }

      const payload = (await response.json()) as Record<string, { ticker?: string; cik_str?: number }>;
      const map = new Map<string, string>();

      for (const row of Object.values(payload)) {
        const ticker = typeof row?.ticker === "string" ? normalizeSymbol(row.ticker) : null;
        const cik = typeof row?.cik_str === "number" && Number.isFinite(row.cik_str)
          ? String(Math.trunc(row.cik_str)).padStart(10, "0")
          : null;
        if (ticker && cik) {
          map.set(ticker, cik);
        }
      }

      return map;
    })().catch((error) => {
      tickerMapPromise = null;
      throw error;
    });
  }

  return tickerMapPromise;
}

async function fetchSecFacts(symbol: string): Promise<SecCompanyFactsResponse | null> {
  const normalized = normalizeSymbol(symbol);
  const tickerMap = await fetchTickerMap();
  const cik = tickerMap.get(normalized);
  if (!cik) return null;

  const response = await fetch(`${SEC_COMPANY_FACTS_URL}/CIK${cik}.json`, {
    headers: SEC_HEADERS,
    next: { revalidate: SEC_REVALIDATE_SECONDS }
  });

  if (!response.ok) {
    throw new Error(`SEC company facts failed (${response.status})`);
  }

  return (await response.json()) as SecCompanyFactsResponse;
}

function buildFallbackFromFacts(payload: SecCompanyFactsResponse | null): SecFundamentalsFallback {
  const facts = payload?.facts?.["us-gaap"];
  if (!facts) {
    return {
      revenueGrowth: null,
      earningsQuarterlyGrowth: null,
      ttmFreeCashflow: null,
      trailingEpsTtm: null,
      sharesOutstanding: null
    };
  }

  const deiFacts = ((payload?.facts as Record<string, unknown> | undefined)?.dei ?? {}) as Record<
    string,
    { units?: Record<string, SecFactRow[]> }
  >;
  const sharesRows = pickUnitRows(
    deiFacts,
    ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
    ["shares"]
  )
    .filter((row) => typeof row.val === "number" && Number.isFinite(row.val) && row.val > 0)
    .sort((left, right) => Date.parse(left.end ?? "") - Date.parse(right.end ?? ""));

  const revenueQuarterly = normalizeQuarterSeries(
    pickUnitRows(
      facts,
      ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
      ["USD"]
    ),
  );
  const revenueAnnual = normalizeSeries(
    pickUnitRows(
      facts,
      ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
      ["USD"]
    ),
    "annual"
  );

  const epsQuarterly = normalizeQuarterSeries(
    pickUnitRows(
      facts,
      ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
      ["USD/shares"]
    ),
  );
  const epsAnnual = normalizeSeries(
    pickUnitRows(
      facts,
      ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
      ["USD/shares"]
    ),
    "annual"
  );

  const cfoQuarterly = normalizeQuarterSeries(
    pickUnitRows(
      facts,
      ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
      ["USD"]
    ),
  );
  const cfoAnnual = normalizeSeries(
    pickUnitRows(
      facts,
      ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
      ["USD"]
    ),
    "annual"
  );

  const capexQuarterly = normalizeQuarterSeries(
    pickUnitRows(
      facts,
      ["PaymentsToAcquirePropertyPlantAndEquipment", "PropertyPlantAndEquipmentAdditions", "CapitalExpendituresIncurredButNotYetPaid"],
      ["USD"]
    ),
  );
  const capexAnnual = normalizeSeries(
    pickUnitRows(
      facts,
      ["PaymentsToAcquirePropertyPlantAndEquipment", "PropertyPlantAndEquipmentAdditions", "CapitalExpendituresIncurredButNotYetPaid"],
      ["USD"]
    ),
    "annual"
  );

  const revenueGrowth = latestYoYGrowth(revenueQuarterly, revenueAnnual);
  const earningsQuarterlyGrowth = latestYoYGrowth(epsQuarterly, epsAnnual);
  const trailingEpsTtm = trailingTwelveMonths(epsQuarterly, epsAnnual);
  const ttmOperatingCashflow = trailingTwelveMonths(cfoQuarterly, cfoAnnual);
  const ttmCapex = trailingTwelveMonths(capexQuarterly, capexAnnual);
  const ttmFreeCashflow =
    ttmOperatingCashflow !== null && ttmCapex !== null
      ? ttmOperatingCashflow - Math.abs(ttmCapex)
      : null;
  const sharesOutstanding = typeof sharesRows.at(-1)?.val === "number" ? (sharesRows.at(-1)?.val ?? null) : null;

  return {
    revenueGrowth,
    earningsQuarterlyGrowth,
    ttmFreeCashflow,
    trailingEpsTtm,
    sharesOutstanding
  };
}

export const __test__ = {
  buildFallbackFromFacts,
  normalizeQuarterSeries
};

export async function fetchSecFundamentalsFallback(symbol: string): Promise<SecFundamentalsFallback> {
  const normalized = normalizeSymbol(symbol);
  const existing = factsPromiseBySymbol.get(normalized);
  if (existing) {
    return existing;
  }

  const request = fetchSecFacts(normalized)
    .then((payload) => buildFallbackFromFacts(payload))
    .catch(() => ({
      revenueGrowth: null,
      earningsQuarterlyGrowth: null,
      ttmFreeCashflow: null,
      trailingEpsTtm: null,
      sharesOutstanding: null
    }))
    .finally(() => {
      factsPromiseBySymbol.delete(normalized);
    });

  factsPromiseBySymbol.set(normalized, request);
  return request;
}
