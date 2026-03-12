#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");
const mode = process.argv.includes("--json") ? "json" : "text";

const exts = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(p));
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

function resolveImport(specifier, fromFile) {
  if (!specifier.startsWith("@/") && !specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }

  const base = specifier.startsWith("@/")
    ? path.join(srcRoot, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);

  const candidates = [];
  const ext = path.extname(base);
  if (exts.includes(ext)) {
    candidates.push(base);
  } else {
    for (const suffix of exts) candidates.push(`${base}${suffix}`);
    for (const suffix of exts) candidates.push(path.join(base, `index${suffix}`));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }
  return null;
}

function parseImports(content) {
  const found = [];
  const patterns = [
    /import\s+[^"'`]*?from\s+["'`]([^"'`]+)["'`]/g,
    /export\s+[^"'`]*?from\s+["'`]([^"'`]+)["'`]/g,
    /import\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  ];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      found.push(match[1]);
    }
  }
  return found;
}

const files = walk(srcRoot).map((p) => path.normalize(p));
const fileSet = new Set(files);
const graph = new Map();
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const deps = new Set();
  for (const specifier of parseImports(content)) {
    const resolved = resolveImport(specifier, file);
    if (resolved && fileSet.has(resolved)) deps.add(resolved);
  }
  graph.set(file, [...deps]);
}

const state = new Map();
const stack = [];
const stackIndex = new Map();
const cycles = new Set();

function normalizeCycle(nodes) {
  const rel = nodes.map((n) => path.relative(repoRoot, n));
  let best = rel;
  for (let i = 1; i < rel.length; i += 1) {
    const rotated = rel.slice(i).concat(rel.slice(0, i));
    if (rotated.join("|") < best.join("|")) best = rotated;
  }
  return best.join(" -> ");
}

function dfs(node) {
  state.set(node, 1);
  stackIndex.set(node, stack.length);
  stack.push(node);

  for (const dep of graph.get(node) ?? []) {
    const depState = state.get(dep) ?? 0;
    if (depState === 0) {
      dfs(dep);
    } else if (depState === 1) {
      const start = stackIndex.get(dep);
      if (start != null) {
        const cycleNodes = stack.slice(start);
        if (cycleNodes.length > 1) cycles.add(normalizeCycle(cycleNodes));
      }
    }
  }

  stack.pop();
  stackIndex.delete(node);
  state.set(node, 2);
}

for (const file of files) {
  if ((state.get(file) ?? 0) === 0) dfs(file);
}

const output = [...cycles].sort();
if (mode === "json") {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else if (output.length === 0) {
  console.log("check-import-cycles: ok (no cycles)");
} else {
  console.log(`check-import-cycles: found ${output.length} cycle(s)`);
  for (const cycle of output) console.log(cycle);
}
