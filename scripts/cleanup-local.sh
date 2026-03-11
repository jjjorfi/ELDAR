#!/usr/bin/env bash
set -euo pipefail

echo "[$(date)] cleanup start"

rm -rf .next/cache
# Keep snapshot store to avoid blank dashboard after cache cleanup.
# Snapshot data is lightweight and critical for fast startup resilience.
rm -f .cache/snapshot-store.backup.json

npm cache clean --force >/dev/null 2>&1 || true
rm -rf ~/.npm/_cacache

echo "[$(date)] cleanup done"
df -h | head -n 12
