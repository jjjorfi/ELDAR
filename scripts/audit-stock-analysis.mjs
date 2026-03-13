import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE_URL = process.env.AUDIT_BASE_URL || "http://127.0.0.1:3000";
const DATAHUB_SP500_CSV_URL = "https://datahub.io/core/s-and-p-500-companies/r/constituents.csv";
const FALLBACK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK.B", "LLY", "AVGO", "TSLA"];
const REPO_ROOT = process.cwd();
const DEFAULT_AUDIT_OUTPUT_DIR = path.join(os.homedir(), ".eldar", "audits");

function sanitizeSymbol(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z.\-]/g, "");
}

function validSymbol(symbol) {
  return /^[A-Z.\-]{1,12}$/.test(symbol);
}

function uniqueSorted(items) {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

async function fetchSP500Symbols() {
  try {
    const res = await fetch(DATAHUB_SP500_CSV_URL, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" }
    });

    if (!res.ok) {
      return FALLBACK_SYMBOLS;
    }

    const csv = await res.text();
    const lines = csv.split(/\r?\n/).slice(1);
    const symbols = lines
      .map((line) => line.split(",")[0]?.replace(/^"|"$/g, "").trim())
      .map(sanitizeSymbol)
      .filter(validSymbol);

    const parsed = uniqueSorted(symbols);
    return parsed.length >= 450 ? parsed : FALLBACK_SYMBOLS;
  } catch {
    return FALLBACK_SYMBOLS;
  }
}

async function postRate(symbol, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/api/rate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol }),
      signal: controller.signal
    });

    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    return { ok: res.ok, status: res.status, payload };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: { error: error instanceof Error ? error.message : "Unknown error" }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractMissingFactors(analysis) {
  const factors = Array.isArray(analysis?.factors) ? analysis.factors : [];
  return factors
    .filter((factor) => {
      const rule = String(factor?.ruleMatched ?? "");
      const metric = String(factor?.metricValue ?? "");
      return /^No\s/i.test(rule) || /\bN\/A\b/i.test(metric) || /\bunavailable\b/i.test(metric);
    })
    .map((factor) => ({
      factor: String(factor?.factor ?? "Unknown"),
      ruleMatched: String(factor?.ruleMatched ?? ""),
      metricValue: String(factor?.metricValue ?? "")
    }));
}

function topEntries(mapObj, limit = 15) {
  return Object.entries(mapObj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveAuditOutputDir() {
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

async function runAudit() {
  const symbols = await fetchSP500Symbols();

  const factorMissingCounts = Object.create(null);
  const errorCounts = Object.create(null);

  const failures = [];
  const missingData = [];
  const ok = [];

  const startMs = Date.now();

  for (let i = 0; i < symbols.length; i += 1) {
    const symbol = symbols[i];
    const result = await postRate(symbol);

    if (!result.ok) {
      const message = String(result.payload?.error ?? `HTTP ${result.status}`);
      failures.push({ symbol, status: result.status, error: message });
      errorCounts[message] = (errorCounts[message] ?? 0) + 1;
    } else {
      const analysis = result.payload?.analysis;
      if (!analysis || !Array.isArray(analysis.factors)) {
        const message = "Missing analysis payload";
        failures.push({ symbol, status: result.status, error: message });
        errorCounts[message] = (errorCounts[message] ?? 0) + 1;
      } else {
        const missingFactors = extractMissingFactors(analysis);
        ok.push({ symbol, score: analysis.score, rating: analysis.rating });
        if (missingFactors.length > 0) {
          missingData.push({
            symbol,
            score: analysis.score,
            rating: analysis.rating,
            missingFactors
          });

          for (const item of missingFactors) {
            factorMissingCounts[item.factor] = (factorMissingCounts[item.factor] ?? 0) + 1;
          }
        }
      }
    }

    if ((i + 1) % 25 === 0 || i === symbols.length - 1) {
      const elapsedSec = Math.round((Date.now() - startMs) / 1000);
      console.log(
        `[${i + 1}/${symbols.length}] ok=${ok.length} failures=${failures.length} withMissing=${missingData.length} elapsed=${elapsedSec}s`
      );
    }

    // Small delay to reduce upstream burst rate.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const durationSec = Math.round((Date.now() - startMs) / 1000);

  const summary = {
    timestamp: new Date().toISOString(),
    universeSize: symbols.length,
    analyzedOk: ok.length,
    failed: failures.length,
    withMissingData: missingData.length,
    durationSec,
    topMissingFactors: topEntries(factorMissingCounts),
    topErrors: topEntries(errorCounts)
  };

  const output = {
    summary,
    failures,
    missingData,
    ok
  };

  const stamp = nowStamp();
  const outDir = resolveAuditOutputDir();
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `stock-analysis-audit-${stamp}.json`);
  const mdPath = path.join(outDir, `stock-analysis-audit-${stamp}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(output, null, 2), "utf8");

  const md = [
    "# Stock Analysis Audit",
    "",
    `- Timestamp: ${summary.timestamp}`,
    `- Universe Size: ${summary.universeSize}`,
    `- Analyzed OK: ${summary.analyzedOk}`,
    `- Failed: ${summary.failed}`,
    `- With Missing Data: ${summary.withMissingData}`,
    `- Duration: ${summary.durationSec}s`,
    "",
    "## Top Missing Factors",
    ...summary.topMissingFactors.map((item) => `- ${item.key}: ${item.count}`),
    "",
    "## Top Errors",
    ...summary.topErrors.map((item) => `- ${item.key}: ${item.count}`),
    "",
    "## Output Files",
    `- JSON: ${jsonPath}`,
    `- Markdown: ${mdPath}`
  ].join("\n");

  await fs.writeFile(mdPath, md, "utf8");

  console.log("\nAudit complete.");
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);
  console.log(`Summary: ${JSON.stringify(summary)}`);
}

runAudit().catch((error) => {
  console.error("Audit failed:", error);
  process.exitCode = 1;
});
