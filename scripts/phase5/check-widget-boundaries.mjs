#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const widgetDir = path.join(root, "src/components/eldar/widgets");

if (!fs.existsSync(widgetDir)) {
  console.log("[guard:widget-boundaries] no widget directory found; skipping.");
  process.exit(0);
}

const importDenyList = [
  "@/lib/market/",
  "@/lib/normalize/adapters",
  "@/lib/scoring/",
  "@/lib/orchestration/",
  "@/lib/ai/client",
  "@/lib/ai/queue",
  "@/lib/ai/generators",
  "@/lib/cache/redis",
  "ioredis",
  "redis",
  "groq-sdk"
];

const tokenDenyList = [
  "fetch(",
  "generateScoreRationale(",
  "enqueueAI(",
  "getGroq(",
  "cacheGet(",
  "cacheSet(",
  "cacheDelete(",
  "acquireLock("
];

function collectTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(target));
      continue;
    }
    if (entry.isFile() && (target.endsWith(".ts") || target.endsWith(".tsx"))) {
      files.push(target);
    }
  }
  return files;
}

const files = collectTsFiles(widgetDir);
const violations = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);

  const importRegex = /import\s+[^'"]*from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importRegex)) {
    const imported = match[1] ?? "";
    for (const denied of importDenyList) {
      if (imported.includes(denied)) {
        violations.push(`[import] ${rel} -> ${imported} matches denied pattern "${denied}"`);
      }
    }
  }

  for (const token of tokenDenyList) {
    if (source.includes(token)) {
      violations.push(`[token] ${rel} contains denied token "${token}"`);
    }
  }
}

if (violations.length > 0) {
  console.error("[guard:widget-boundaries] failed");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`[guard:widget-boundaries] passed (${files.length} files checked)`);

