#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const routesRoot = path.join(repoRoot, "src", "app", "api");

const forbidden = [
  "@/lib/market/providers/",
  "@/lib/market/orchestration/temporary-fallbacks",
  "@/lib/financials/eldar-financials-pipeline"
];

const allowlist = new Set([
  "src/app/api/health/route.ts"
]);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (entry.name === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

const violations = [];
for (const file of walk(routesRoot)) {
  const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
  if (allowlist.has(rel)) continue;

  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("import") && !line.includes("from")) continue;
    for (const token of forbidden) {
      if (line.includes(token)) {
        violations.push(`${rel}:${i + 1}: forbidden route import (${token})`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Route boundary violations:");
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log("check-route-boundaries: ok");
