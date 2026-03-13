import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  buildCompanyFinancials,
  getCompanyFinancials,
  isSecUnavailableError
} from "../src/lib/financials/eldar-financials-pipeline";
import { fetchSP500Symbols } from "../src/lib/market/universe/sp500";

type Confidence = "high" | "medium" | "low";
const REPO_ROOT = process.cwd();
const DEFAULT_AUDIT_OUTPUT_DIR = path.join(os.homedir(), ".eldar", "audits");

interface TickerCheck {
  ticker: string;
  ok: boolean;
  error?: string;
  confidence?: Confidence;
  pricesSource?: string;
  warningsCount?: number;
  imputedCount?: number;
  incomeQuarters?: number;
  latestPeriodEnd?: string;
  cik?: string;
  latestRevenue?: number | null;
  latestNetIncome?: number | null;
  latestEbit?: number | null;
  ttmRevenue?: number | null;
  ttmEbit?: number | null;
  ttmFCF?: number | null;
  hasRevenueSourceTrace?: boolean;
  hasCashFlowSourceTrace?: boolean;
}

interface Summary {
  timestamp: string;
  universeSize: number;
  tested: number;
  ok: number;
  failed: number;
  successRate: number;
  confidence: Record<Confidence, number>;
  pricesSource: Record<string, number>;
  missingCore: number;
  partialHistory: number;
  totalWarnings: number;
  totalImputed: number;
  durationSec: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveAuditOutputDir(): string {
  const configured = process.env.ELDAR_AUDIT_DIR?.trim();
  const candidate = path.resolve(configured && configured.length > 0 ? configured : DEFAULT_AUDIT_OUTPUT_DIR);
  const relativeToRepo = path.relative(REPO_ROOT, candidate);
  const pointsInsideRepo =
    relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo));

  if (pointsInsideRepo && process.env.ELDAR_ALLOW_REPO_AUDIT_OUTPUT !== "1") {
    return DEFAULT_AUDIT_OUTPUT_DIR;
  }

  return candidate;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function hasValidCik(cik: string | undefined): boolean {
  if (!cik) return false;
  return /^\d{10}$/.test(cik);
}

function hasFinitePositive(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasFiniteValue(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNumericArg(flag: string, fallback: number): number {
  const inline = process.argv.find((arg) => arg.startsWith(`--${flag}=`));
  if (inline) {
    const value = Number.parseInt(inline.split("=")[1] ?? "", 10);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const index = process.argv.findIndex((arg) => arg === `--${flag}`);
  if (index >= 0) {
    const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return fallback;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function loadFinancialsWithRetry(ticker: string, forceRefresh: boolean): Promise<Awaited<ReturnType<typeof getCompanyFinancials>>> {
  const attempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (forceRefresh) {
        return await buildCompanyFinancials(ticker, { forceRefresh: true, quartersBack: 12 });
      }
      return await getCompanyFinancials(ticker);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(180 * attempt);
      }
    }
  }

  // SEC 429/5xx should not nuke a full audit run when a valid cached snapshot exists.
  if (forceRefresh && isSecUnavailableError(lastError)) {
    return getCompanyFinancials(ticker);
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown financials loading error.");
}

async function run(): Promise<void> {
  loadEnvConfig(process.cwd());
  const forceRefresh = process.argv.includes("--force-refresh");
  const randomSample = process.argv.includes("--random");
  const start = Date.now();
  const allSymbols = await fetchSP500Symbols();
  const limit = Math.min(allSymbols.length, readNumericArg("limit", allSymbols.length));
  const concurrency = Math.max(1, Math.min(8, readNumericArg("concurrency", forceRefresh ? 2 : 4)));
  const spacingMs = readNumericArg("spacing-ms", forceRefresh ? 90 : 30);
  const symbols = (randomSample ? shuffle(allSymbols) : allSymbols).slice(0, limit);

  const checks: TickerCheck[] = [];
  const failed: TickerCheck[] = [];
  const suspicious: TickerCheck[] = [];

  const confidenceCounter: Record<Confidence, number> = {
    high: 0,
    medium: 0,
    low: 0
  };

  const priceSourceCounter: Record<string, number> = {};

  let totalWarnings = 0;
  let totalImputed = 0;
  let partialHistory = 0;
  let missingCore = 0;

  const queue = [...symbols];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const ticker = queue.shift();
      if (!ticker) continue;

      try {
        const financials = await loadFinancialsWithRetry(ticker, forceRefresh);
        const latestIncome = financials.income.at(-1);
        const latestTrace = financials.quality.latestFieldSourceTrace ?? {};
        const check: TickerCheck = {
          ticker,
          ok: true,
          confidence: financials.confidence,
          pricesSource: financials.quality.pricesSource,
          warningsCount: financials.warnings.length,
          imputedCount: financials.imputedFields.length,
          incomeQuarters: financials.income.length,
          latestPeriodEnd: latestIncome?.periodEnd,
          cik: financials.cik,
          latestRevenue: latestIncome?.revenue ?? null,
          latestNetIncome: latestIncome?.netIncome ?? null,
          latestEbit: latestIncome?.ebit ?? null,
          ttmRevenue: financials.ttm.revenue ?? null,
          ttmEbit: financials.ttm.ebit ?? null,
          ttmFCF: financials.ttm.freeCashFlow ?? null,
          hasRevenueSourceTrace: typeof latestTrace.revenue === "string" && latestTrace.revenue.length > 0,
          hasCashFlowSourceTrace:
            typeof latestTrace.operatingCashFlow === "string" && latestTrace.operatingCashFlow.length > 0
        };

        checks.push(check);

        confidenceCounter[financials.confidence] += 1;
        const sourceKey = financials.quality.pricesSource;
        priceSourceCounter[sourceKey] = (priceSourceCounter[sourceKey] ?? 0) + 1;
        totalWarnings += financials.warnings.length;
        totalImputed += financials.imputedFields.length;

        const isPartial = financials.income.length < 4;
        if (isPartial) partialHistory += 1;

        const coreInvalid =
          !hasValidCik(financials.cik) ||
          !hasFinitePositive(latestIncome?.revenue ?? null) ||
          !hasFiniteValue(latestIncome?.netIncome ?? null) ||
          !hasFiniteValue(latestIncome?.ebit ?? null) ||
          !hasFinitePositive(financials.ttm.revenue ?? null) ||
          !(check.hasRevenueSourceTrace ?? false);

        if (coreInvalid) {
          missingCore += 1;
          suspicious.push(check);
        }
      } catch (error) {
        const result: TickerCheck = {
          ticker,
          ok: false,
          error: toErrorMessage(error)
        };
        checks.push(result);
        failed.push(result);
      }

      if (checks.length % 25 === 0 || checks.length === symbols.length) {
        const elapsedSec = Math.round((Date.now() - start) / 1000);
        const okCount = checks.length - failed.length;
        console.log(
          `[${checks.length}/${symbols.length}] ok=${okCount} failed=${failed.length} suspicious=${suspicious.length} elapsed=${elapsedSec}s`
        );
      }

      // Avoid burst pressure against remote providers in case of cold misses.
      if (spacingMs > 0) {
        await delay(spacingMs);
      }
    }
  });

  await Promise.all(workers);

  const okCount = checks.length - failed.length;
  const durationSec = Math.round((Date.now() - start) / 1000);
  const mode = forceRefresh ? "force-refresh" : "cache-first";
  const summary: Summary = {
    timestamp: new Date().toISOString(),
    universeSize: symbols.length,
    tested: checks.length,
    ok: okCount,
    failed: failed.length,
    successRate: symbols.length > 0 ? round((okCount / symbols.length) * 100, 2) : 0,
    confidence: confidenceCounter,
    pricesSource: priceSourceCounter,
    missingCore,
    partialHistory,
    totalWarnings,
    totalImputed,
    durationSec
  };

  const report = {
    summary,
    failed,
    suspicious,
    checks
  };

  const stamp = nowStamp();
  const outDir = resolveAuditOutputDir();
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `sec-financials-audit-${stamp}.json`);
  const mdPath = path.join(outDir, `sec-financials-audit-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const topFailures = failed.slice(0, 20);
  const topSuspicious = suspicious.slice(0, 20);
  const priceSourceLines = Object.entries(summary.pricesSource)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `- ${source}: ${count}`);
  const md = [
    "# SEC Financials Deep Audit",
    "",
    `- Mode: ${mode}`,
    `- Concurrency: ${concurrency}`,
    `- Spacing (ms): ${spacingMs}`,
    `- Random sample: ${randomSample ? "yes" : "no"}`,
    `- Timestamp: ${summary.timestamp}`,
    `- Universe Size: ${summary.universeSize}`,
    `- Tested: ${summary.tested}`,
    `- OK: ${summary.ok}`,
    `- Failed: ${summary.failed}`,
    `- Success Rate: ${summary.successRate}%`,
    `- Missing Core: ${summary.missingCore}`,
    `- Partial History (<4Q): ${summary.partialHistory}`,
    `- Total Warnings: ${summary.totalWarnings}`,
    `- Total Imputed Fields: ${summary.totalImputed}`,
    `- Duration: ${summary.durationSec}s`,
    "",
    "## Confidence Distribution",
    `- high: ${summary.confidence.high}`,
    `- medium: ${summary.confidence.medium}`,
    `- low: ${summary.confidence.low}`,
    "",
    "## Prices Source Distribution",
    ...(priceSourceLines.length > 0 ? priceSourceLines : ["- none"]),
    "",
    "## First 20 Failures",
    ...(
      topFailures.length > 0
        ? topFailures.map((row) => `- ${row.ticker}: ${row.error}`)
        : ["- none"]
    ),
    "",
    "## First 20 Suspicious Core Rows",
    ...(
      topSuspicious.length > 0
        ? topSuspicious.map((row) =>
            `- ${row.ticker}: cik=${row.cik ?? "n/a"} rev=${row.latestRevenue ?? "n/a"} net=${row.latestNetIncome ?? "n/a"} ebit=${row.latestEbit ?? "n/a"} ttmRev=${row.ttmRevenue ?? "n/a"} trace=${row.hasRevenueSourceTrace ? "yes" : "no"}`
          )
        : ["- none"]
    ),
    "",
    "## Output Files",
    `- JSON: ${jsonPath}`,
    `- Markdown: ${mdPath}`
  ].join("\n");

  await fs.writeFile(mdPath, md, "utf8");
  console.log(`\nAudit complete: ${jsonPath}`);
  console.log(`Summary: ${JSON.stringify(summary)}`);
}

run().catch((error) => {
  console.error("SEC financials audit failed:", error);
  process.exitCode = 1;
});
