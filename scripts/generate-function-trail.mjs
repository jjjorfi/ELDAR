#!/usr/bin/env node

/**
 * Generates REFACTOR_FUNCTION_TRAIL.md by scanning source files for top-level
 * function declarations and exported arrow functions.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, "REFACTOR_FUNCTION_TRAIL.md");
const INCLUDE_DIRS = ["src", "realtime-server"];
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);
const VALID_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function isFunctionLine(line) {
  return (
    /^export\s+(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(line) ||
    /^(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(line) ||
    /^export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?function\b/.test(line) ||
    /^const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?function\b/.test(line) ||
    /^export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?\([^=]*\)\s*=>/.test(line) ||
    /^const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?\([^=]*\)\s*=>/.test(line) ||
    /^export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?[A-Za-z_$][\w$]*\s*=>/.test(line) ||
    /^const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?[A-Za-z_$][\w$]*\s*=>/.test(line)
  );
}

function extractFunctionName(line) {
  const patterns = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/,
    /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/,
    /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^=]*\)\s*=>/,
    /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^=]*\)\s*=>/,
    /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/,
    /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function extractJsDocSummary(lines, lineIndex) {
  let cursor = lineIndex - 1;

  while (cursor >= 0 && lines[cursor].trim() === "") {
    cursor -= 1;
  }

  if (cursor < 0 || !lines[cursor].trim().endsWith("*/")) {
    return "No inline summary.";
  }

  const commentBlock = [];
  while (cursor >= 0) {
    commentBlock.unshift(lines[cursor]);
    if (lines[cursor].trim().startsWith("/**")) {
      break;
    }
    cursor -= 1;
  }

  if (!commentBlock[0]?.trim().startsWith("/**")) {
    return "No inline summary.";
  }

  for (const rawLine of commentBlock) {
    const cleaned = rawLine
      .trim()
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .replace(/^\*\s?/, "")
      .trim();
    if (cleaned && !cleaned.startsWith("@")) {
      return cleaned;
    }
  }

  return "No inline summary.";
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (VALID_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectFunctions(filePath) {
  const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, "/");
  const source = await fs.readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/);

  const functions = [];
  lines.forEach((line, index) => {
    if (!isFunctionLine(line)) {
      return;
    }

    const name = extractFunctionName(line);
    if (!name) {
      return;
    }

    functions.push({
      name,
      line: index + 1,
      summary: extractJsDocSummary(lines, index)
    });
  });

  if (functions.length === 0) {
    return null;
  }

  return {
    path: relativePath,
    functions
  };
}

async function main() {
  const files = (
    await Promise.all(
      INCLUDE_DIRS.map(async (directory) => {
        const absolute = path.join(ROOT, directory);
        try {
          const stats = await fs.stat(absolute);
          if (!stats.isDirectory()) {
            return [];
          }
        } catch {
          return [];
        }
        return walk(absolute);
      })
    )
  ).flat();

  const scanned = await Promise.all(files.map((filePath) => collectFunctions(filePath)));
  const sections = scanned
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));

  const generatedAt = new Date().toISOString();
  const lines = [
    "# Refactor Function Trail",
    "",
    "Purpose: machine-generated function trail for refactor continuity.",
    `Generated: ${generatedAt}`,
    "Scope: src/** and realtime-server/**",
    ""
  ];

  for (const section of sections) {
    lines.push(`## ${section.path}`);
    for (const item of section.functions) {
      lines.push(`- \`${item.name}\` (line ${item.line}) — ${item.summary}`);
    }
    lines.push("");
  }

  await fs.writeFile(OUTPUT_FILE, lines.join("\n"), "utf8");
}

main().catch((error) => {
  console.error("[generate-function-trail] failed", error);
  process.exitCode = 1;
});
