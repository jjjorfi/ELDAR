#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const CRITICAL_SYSTEMS = [
  "src/lib/financials/eldar-financials-adapter.ts",
  "src/lib/financials/eldar-financials-pipeline.ts",
  "src/lib/financials/eldar-financials-schema.ts",
  "src/lib/financials/eldar-financials-taxonomy.ts",
  "src/lib/financials/eldar-financials-types.ts",
  "src/lib/normalize/adapters/fundamentals/edgar.adapter.ts",
  "src/lib/scoring/engine.ts",
  "src/lib/scoring/macro/eldar-macro-v2.ts"
];

const ALLOW_ENV = "ELDAR_ALLOW_CRITICAL_SYSTEM_DELETIONS";
const REASON_ENV = "ELDAR_CRITICAL_DELETION_REASON";

function listChangedFiles(args) {
  try {
    const output = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function unique(values) {
  return [...new Set(values)];
}

function listChangedStatuses(args) {
  try {
    const output = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("\t"));
  } catch {
    return [];
  }
}

const changedFiles = unique([
  ...listChangedFiles(["diff", "--name-only", "--cached", "--relative"]),
  ...listChangedFiles(["diff", "--name-only", "--relative"])
]);

const deletionCandidates = [
  ...listChangedStatuses(["diff", "--name-status", "-M", "--cached", "--relative"]),
  ...listChangedStatuses(["diff", "--name-status", "-M", "--relative"])
];

const blockedDeletions = [];

for (const parts of deletionCandidates) {
  const status = parts[0] ?? "";
  const kind = status.charAt(0);

  if (kind === "D") {
    const deletedPath = parts[1] ?? "";
    if (CRITICAL_SYSTEMS.includes(deletedPath)) {
      blockedDeletions.push({ type: "delete", source: deletedPath, target: null });
    }
    continue;
  }

  if (kind === "R") {
    const sourcePath = parts[1] ?? "";
    const targetPath = parts[2] ?? "";
    if (CRITICAL_SYSTEMS.includes(sourcePath)) {
      blockedDeletions.push({ type: "rename", source: sourcePath, target: targetPath || null });
    }
  }
}

if (blockedDeletions.length === 0) {
  console.log("check-critical-systems: ok");
  process.exit(0);
}

const allowCriticalDeletions = process.env[ALLOW_ENV] === "1";
const reason = (process.env[REASON_ENV] ?? "").trim();

if (!allowCriticalDeletions || reason.length === 0) {
  console.error("[guard:critical-systems] blocked critical system deletion");
  console.error("");
  console.error("Protected files marked for deletion or rename:");
  for (const entry of blockedDeletions) {
    if (entry.type === "rename") {
      console.error(`- rename: ${entry.source} -> ${entry.target}`);
      continue;
    }
    console.error(`- delete: ${entry.source}`);
  }
  console.error("");
  console.error(
    `To delete or rename these files intentionally, rerun with ${ALLOW_ENV}=1 and a non-empty ${REASON_ENV}.`
  );
  process.exit(1);
}

console.log(`[guard:critical-systems] deletion acknowledged: ${reason}`);
for (const entry of blockedDeletions) {
  if (entry.type === "rename") {
    console.log(`- rename: ${entry.source} -> ${entry.target}`);
    continue;
  }
  console.log(`- delete: ${entry.source}`);
}
