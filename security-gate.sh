#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

START_TS="$(date +%s)"

fail() {
  echo "SECURITY-GATE: FAIL - $1" >&2
  exit 1
}

info() {
  echo "SECURITY-GATE: $1"
}

if command -v rg >/dev/null 2>&1; then
  HAS_RG=1
else
  HAS_RG=0
fi

# Pattern set for obvious high-entropy/API key leaks.
SECRET_PATTERN='(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{35}|sk_(live|test)_[0-9A-Za-z]{16,}|pk_(live|test)_[0-9A-Za-z]{16,}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})'

info "checking tracked env files"
if [[ "$HAS_RG" -eq 1 ]]; then
  TRACKED_ENV="$(git ls-files | rg -N '^\.env(\..+)?$' | rg -v -N '^\.env\.example$|^\.env\.local\.template$' || true)"
else
  TRACKED_ENV="$(git ls-files | grep -E '^\.env(\..+)?$' | grep -Ev '^\.env\.example$|^\.env\.local\.template$' || true)"
fi
if [[ -n "$TRACKED_ENV" ]]; then
  echo "$TRACKED_ENV" >&2
  fail "tracked .env file detected. Remove it from git and rotate exposed secrets."
fi

info "checking repository env artifacts for secrets"
while IFS= read -r env_file; do
  [[ -z "$env_file" ]] && continue
  case "$env_file" in
    ./.env.example|./.env.local.template|.env.example|.env.local.template)
      continue
      ;;
  esac
  if [[ "$HAS_RG" -eq 1 ]]; then
    if rg -n --pcre2 -i "$SECRET_PATTERN" "$env_file" >/dev/null; then
      echo "$env_file" >&2
      fail "possible secret detected in env artifact. Rotate compromised credentials before merge."
    fi
  else
    if grep -E -i "$SECRET_PATTERN" "$env_file" >/dev/null 2>&1; then
      echo "$env_file" >&2
      fail "possible secret detected in env artifact. Rotate compromised credentials before merge."
    fi
  fi
done < <(find . -maxdepth 1 -type f -name '.env*' 2>/dev/null | sort)

info "checking all API routes enforce shared guard"
MISSING_GUARD=()
if [[ "$HAS_RG" -eq 1 ]]; then
  ROUTE_LIST_CMD=(rg --files src/app/api -g 'route.ts')
else
  ROUTE_LIST_CMD=(find src/app/api -type f -name 'route.ts')
fi

while IFS= read -r route; do
  [[ -z "$route" ]] && continue
  if [[ "$HAS_RG" -eq 1 ]]; then
    HAS_DIRECT_IMPORT=0
    rg -q "from [\"']@/lib/security/guard[\"']" "$route" && HAS_DIRECT_IMPORT=1
    HAS_DIRECT_AWAIT=0
    rg -q "await guard\\(request\\)" "$route" && HAS_DIRECT_AWAIT=1
    HAS_WRAPPER_IMPORT=0
    rg -q "from [\"']@/lib/api/route-security[\"']" "$route" && HAS_WRAPPER_IMPORT=1
    HAS_WRAPPER_AWAIT=0
    rg -q "await runRouteGuards\\(request" "$route" && HAS_WRAPPER_AWAIT=1
  else
    HAS_DIRECT_IMPORT=0
    grep -Eq "from [\"']@/lib/security/guard[\"']" "$route" && HAS_DIRECT_IMPORT=1
    HAS_DIRECT_AWAIT=0
    grep -Eq "await guard\\(request\\)" "$route" && HAS_DIRECT_AWAIT=1
    HAS_WRAPPER_IMPORT=0
    grep -Eq "from [\"']@/lib/api/route-security[\"']" "$route" && HAS_WRAPPER_IMPORT=1
    HAS_WRAPPER_AWAIT=0
    grep -Eq "await runRouteGuards\\(request" "$route" && HAS_WRAPPER_AWAIT=1
  fi

  if [[ "$HAS_DIRECT_IMPORT" -eq 1 ]]; then
    if [[ "$HAS_DIRECT_AWAIT" -ne 1 ]]; then
      MISSING_GUARD+=("$route (missing await guard(request))")
    fi
    continue
  fi

  if [[ "$HAS_WRAPPER_IMPORT" -eq 1 ]]; then
    if [[ "$HAS_WRAPPER_AWAIT" -ne 1 ]]; then
      MISSING_GUARD+=("$route (missing await runRouteGuards(request,...))")
    fi
    continue
  fi

  MISSING_GUARD+=("$route (missing recognized guard import)")
done < <("${ROUTE_LIST_CMD[@]}" | sort)

if (( ${#MISSING_GUARD[@]} > 0 )); then
  printf '%s\n' "${MISSING_GUARD[@]}" >&2
  fail "API route(s) missing security guard."
fi

info "checking for spoofable cron-marker authorization"
if [[ "$HAS_RG" -eq 1 ]]; then
  if rg -n 'x-vercel-cron' src/app/api realtime-server >/dev/null; then
    fail "spoofable x-vercel-cron authorization pattern detected. Require shared-secret auth instead."
  fi
else
  if grep -R -n 'x-vercel-cron' src/app/api realtime-server >/dev/null 2>&1; then
    fail "spoofable x-vercel-cron authorization pattern detected. Require shared-secret auth instead."
  fi
fi

info "checking git diff for leaked secrets"
DIFF_BLOB="$(git diff --cached --no-color -U0; git diff --no-color -U0)"
if [[ -n "$DIFF_BLOB" ]]; then
  if [[ "$HAS_RG" -eq 1 ]]; then
    if echo "$DIFF_BLOB" | rg -n --pcre2 -i "$SECRET_PATTERN" >/dev/null; then
      fail "possible secret detected in diff. Rotate compromised credentials before merge."
    fi
  else
    if echo "$DIFF_BLOB" | grep -E -i "$SECRET_PATTERN" >/dev/null; then
      fail "possible secret detected in diff. Rotate compromised credentials before merge."
    fi
  fi
fi

info "checking log artifacts for leaked secrets"
if [[ "$HAS_RG" -eq 1 ]]; then
  LOG_LIST_CMD=(rg --files)
else
  LOG_LIST_CMD=(find . -type f)
fi
while IFS= read -r log_file; do
  [[ -z "$log_file" ]] && continue
  if [[ "$HAS_RG" -eq 1 ]]; then
    if rg -n --pcre2 -i "$SECRET_PATTERN" "$log_file" >/dev/null; then
      echo "$log_file" >&2
      fail "possible secret detected in log artifact. Rotate and scrub logs."
    fi
  else
    if grep -E -i "$SECRET_PATTERN" "$log_file" >/dev/null 2>&1; then
      echo "$log_file" >&2
      fail "possible secret detected in log artifact. Rotate and scrub logs."
    fi
  fi
done < <(
  if [[ "$HAS_RG" -eq 1 ]]; then
    "${LOG_LIST_CMD[@]}" | rg -N '(^|/)(logs?/.*|.*\.log)$' || true
  else
    "${LOG_LIST_CMD[@]}" | grep -E '(^|/)(logs?/.*|.*\.log)$' || true
  fi
)

info "running guard regression unit tests"
npm run --silent test:security >/dev/null

info "running dependency vulnerability check (full dependency graph)"
AUDIT_JSON="$(mktemp)"
npm audit --json >"$AUDIT_JSON" || true

read -r HIGH_COUNT CRITICAL_COUNT < <(
  node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const vulns = report?.metadata?.vulnerabilities ?? {};
    const high = Number(vulns.high ?? 0);
    const critical = Number(vulns.critical ?? 0);
    process.stdout.write(`${high} ${critical}\n`);
  ' "$AUDIT_JSON"
)

if (( HIGH_COUNT > 0 || CRITICAL_COUNT > 0 )); then
  cat "$AUDIT_JSON" >&2
  fail "HIGH/CRITICAL dependency vulnerability detected. Patch/upgrade before merge."
fi

ELAPSED="$(( $(date +%s) - START_TS ))"
info "PASS (${ELAPSED}s)"
