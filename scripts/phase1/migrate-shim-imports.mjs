#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const mapPath = path.join(repoRoot, "scripts/phase1/shim-retirement-map.json");
const scanRoots = [path.join(repoRoot, "src"), path.join(repoRoot, "scripts")];

const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const exts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function walk(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const files = scanRoots.filter((dir) => fs.existsSync(dir)).flatMap((dir) => walk(dir));

let filesChanged = 0;
let replacements = 0;
for (const filePath of files) {
  const original = fs.readFileSync(filePath, "utf8");
  let updated = original;

  for (const [fromPath, toPath] of Object.entries(map)) {
    const escaped = escapeRegExp(fromPath);
    const patterns = [
      new RegExp(`from\\s+(["'])${escaped}\\1`, "g"),
      new RegExp(`import\\(\\s*(["'])${escaped}\\1\\s*\\)`, "g"),
      new RegExp(`require\\(\\s*(["'])${escaped}\\1\\s*\\)`, "g")
    ];
    for (const pattern of patterns) {
      updated = updated.replace(pattern, (match, quote) => {
        replacements += 1;
        return match.replace(`${quote}${fromPath}${quote}`, `${quote}${toPath}${quote}`);
      });
    }
  }

  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    filesChanged += 1;
  }
}

console.log(`migrate-shim-imports: changed ${filesChanged} files, ${replacements} replacements`);
