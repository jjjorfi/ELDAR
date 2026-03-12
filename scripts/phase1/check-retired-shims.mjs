#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const mapPath = path.join(repoRoot, "scripts/phase1/shim-retirement-map.json");
const scanRoots = [path.join(repoRoot, "src"), path.join(repoRoot, "scripts")];
const retired = Object.keys(JSON.parse(fs.readFileSync(mapPath, "utf8")));

const exts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(p));
    } else if (exts.has(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

const importPatterns = retired.map((shim) => ({
  shim,
  regex: new RegExp(
    String.raw`(from\s+['"]${shim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]|import\(\s*['"]${shim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]\s*\)|require\(\s*['"]${shim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]\s*\))`,
    "g"
  )
}));

const violations = [];
const files = scanRoots.filter((dir) => fs.existsSync(dir)).flatMap((dir) => walk(dir));

for (const filePath of files) {
  const content = fs.readFileSync(filePath, "utf8");
  const rel = path.relative(repoRoot, filePath);
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of importPatterns) {
      if (rule.regex.test(line)) {
        violations.push(`${rel}:${i + 1}: retired shim import ${rule.shim}`);
      }
      rule.regex.lastIndex = 0;
    }
  }
}

if (violations.length > 0) {
  console.error("Retired shim imports detected:");
  for (const v of violations) console.error(v);
  process.exit(1);
}

console.log("check-retired-shims: ok");
