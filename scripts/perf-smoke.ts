import { loadEnvConfig } from "@next/env";
import { spawn, type ChildProcess } from "node:child_process";
import { URL } from "node:url";

loadEnvConfig(process.cwd());

interface PerfTarget {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

interface PerfSample {
  status: number;
  elapsedMs: number;
  serverMs: number | null;
  cache: string | null;
}

const BASE_URL = (process.env.ELDAR_PERF_BASE_URL ?? "http://localhost:3000").trim();
const REQUEST_TIMEOUT_MS = 20_000;
const ROUNDS = 2;
const SERVER_BOOT_TIMEOUT_MS = 90_000;
const SERVER_PROBE_INTERVAL_MS = 750;
const AUTO_START_LOCAL_SERVER = String(process.env.ELDAR_PERF_AUTO_START ?? "true").toLowerCase() !== "false";

const TARGETS: PerfTarget[] = [
  { name: "home.dashboard", method: "GET", path: "/api/home/dashboard?sectorWindow=YTD" },
  { name: "price.history", method: "GET", path: "/api/price/history?symbol=AAPL&range=1M" },
  { name: "price.live", method: "GET", path: "/api/price/live?symbols=AAPL,MSFT,NVDA" },
  { name: "stock.context", method: "GET", path: "/api/context?symbol=AAPL&live=1" },
  { name: "stock.rate", method: "POST", path: "/api/rate", body: { symbol: "AAPL" } }
];

async function callAdminCron(path: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: {
        "x-vercel-cron": "1"
      },
      signal: controller.signal
    });
  } catch {
    // Best effort only.
  } finally {
    clearTimeout(timeout);
  }
}

async function primeSnapshots(): Promise<void> {
  await callAdminCron("/api/cron/snapshots/warmup?symbolLimit=80");
  for (let pass = 0; pass < 10; pass += 1) {
    await callAdminCron(`/api/cron/snapshots?batch=50&worker=perf-smoke-${pass + 1}`);
    await sleep(250);
  }
}

function toNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReachBaseUrl(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await fetch(baseUrl, {
      method: "GET",
      signal: controller.signal
    });
    return response.status >= 100;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isLocalHttpTarget(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function parsePort(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) return parsed.port;
    return parsed.protocol === "https:" ? "443" : "80";
  } catch {
    return "3000";
  }
}

function startLocalFrontendServer(baseUrl: string): ChildProcess {
  const port = parsePort(baseUrl);
  const child = spawn("npm", ["run", "dev:frontend"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text.length > 0) {
      console.log(`[perf:dev] ${text}`);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text.length > 0) {
      console.error(`[perf:dev] ${text}`);
    }
  });

  return child;
}

async function ensureServerReady(baseUrl: string): Promise<ChildProcess | null> {
  if (await canReachBaseUrl(baseUrl)) {
    return null;
  }

  if (!AUTO_START_LOCAL_SERVER || !isLocalHttpTarget(baseUrl)) {
    throw new Error(
      `Cannot reach ${baseUrl}. Start the app first (example: npm run dev:frontend), or set ELDAR_PERF_BASE_URL.`
    );
  }

  console.log(`[perf] ${baseUrl} is down. Starting local frontend automatically...`);
  const child = startLocalFrontendServer(baseUrl);
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Local frontend exited early with code ${child.exitCode}.`);
    }

    if (await canReachBaseUrl(baseUrl)) {
      console.log("[perf] Local frontend is ready.");
      return child;
    }
    await sleep(SERVER_PROBE_INTERVAL_MS);
  }

  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for ${baseUrl} to become reachable.`);
}

async function runTarget(target: PerfTarget): Promise<PerfSample> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(`${BASE_URL}${target.path}`, {
      method: target.method,
      headers: {
        "Content-Type": "application/json"
      },
      body: target.body ? JSON.stringify(target.body) : undefined,
      signal: controller.signal
    });
    const elapsedMs = Date.now() - started;

    // Drain body so keep-alive sockets can be reused between samples.
    await response.arrayBuffer();

    return {
      status: response.status,
      elapsedMs,
      serverMs: toNumber(response.headers.get("x-eldar-latency-ms")),
      cache: response.headers.get("x-eldar-cache")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  let startedServer: ChildProcess | null = null;

  console.log(`Perf smoke against ${BASE_URL}`);
  console.log(`Rounds per endpoint: ${ROUNDS}`);

  try {
    startedServer = await ensureServerReady(BASE_URL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[perf] ${message}`);
    process.exitCode = 1;
    return;
  }

  const failures: string[] = [];

  try {
    await primeSnapshots();

    for (const target of TARGETS) {
      const samples: PerfSample[] = [];

      for (let round = 1; round <= ROUNDS; round += 1) {
        try {
          const sample = await runTarget(target);
          samples.push(sample);
          const serverText = sample.serverMs === null ? "n/a" : formatMs(sample.serverMs);
          console.log(
            `[${target.name}] round=${round} status=${sample.status} elapsed=${formatMs(sample.elapsedMs)} server=${serverText} cache=${sample.cache ?? "n/a"}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${target.name} round ${round}: ${message}`);
          console.error(`[${target.name}] round=${round} FAILED: ${message}`);
        }
      }

      const elapsed = samples.map((sample) => sample.elapsedMs);
      const server = samples.map((sample) => sample.serverMs).filter((value): value is number => value !== null);
      const statusOk = samples.every((sample) => sample.status >= 200 && sample.status < 300);

      if (!statusOk && samples.length > 0) {
        failures.push(`${target.name}: non-2xx status detected.`);
      }

      if (samples.length > 0) {
        const avgElapsed = average(elapsed);
        const avgServer = server.length > 0 ? average(server) : null;
        console.log(
          `[${target.name}] avg elapsed=${formatMs(avgElapsed)} avg server=${avgServer === null ? "n/a" : formatMs(avgServer)}`
        );
      }
    }

    if (failures.length > 0) {
      console.error("\nPerf smoke finished with failures:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("\nPerf smoke completed successfully.");
  } finally {
    if (startedServer && startedServer.exitCode === null) {
      startedServer.kill("SIGTERM");
    }
  }
}

void main();
