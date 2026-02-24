#!/usr/bin/env python3
"""
ELDAR earnings cache updater (FMP primary).

Fetches:
1) Upcoming earnings calendar rows for a forward window.
2) Historical earnings rows for each tracked symbol.

Outputs:
- CSV cache
- JSON cache

Environment variables:
- FMP_API_KEY (required)
- ELDAR_EARNINGS_SYMBOLS (optional comma-separated list)

Usage examples:
  python3 scripts/update_earnings_cache.py
  python3 scripts/update_earnings_cache.py --symbols AAPL,MSFT,NVDA --days-forward 45
  python3 scripts/update_earnings_cache.py --out-prefix data/eldar_earnings_cache
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

import pandas as pd
import requests


DEFAULT_SYMBOLS = ["AAPL", "MSFT", "TSLA", "NVDA", "JPM", "BA"]
FMP_BASE_URL = "https://financialmodelingprep.com/api/v3"
DEFAULT_TIMEOUT_SECONDS = 25
MAX_RETRIES = 4


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for symbols, horizon, and output location."""
    parser = argparse.ArgumentParser(description="Update ELDAR earnings cache from FMP.")
    parser.add_argument(
        "--symbols",
        type=str,
        default="",
        help="Comma-separated ticker list. If omitted, uses ELDAR_EARNINGS_SYMBOLS env or defaults.",
    )
    parser.add_argument(
        "--days-forward",
        type=int,
        default=30,
        help="Number of days forward for upcoming calendar fetch.",
    )
    parser.add_argument(
        "--history-limit",
        type=int,
        default=20,
        help="Max historical earnings rows to keep per symbol.",
    )
    parser.add_argument(
        "--out-prefix",
        type=str,
        default="data/eldar_earnings_cache",
        help="Output file prefix (without extension).",
    )
    return parser.parse_args()


def resolve_symbols(symbols_arg: str) -> List[str]:
    """Resolve symbols from CLI arg, env var, then defaults."""
    candidates = symbols_arg.strip()
    if not candidates:
        candidates = os.getenv("ELDAR_EARNINGS_SYMBOLS", "").strip()

    if candidates:
        parsed = [part.strip().upper() for part in candidates.split(",") if part.strip()]
        return sorted(set(parsed))

    return DEFAULT_SYMBOLS


def request_with_backoff(url: str, session: requests.Session) -> Any:
    """
    Execute HTTP GET with bounded retries and exponential backoff.

    Raises RuntimeError for non-recoverable failures.
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = session.get(url, timeout=DEFAULT_TIMEOUT_SECONDS)
        except requests.RequestException as exc:
            if attempt >= MAX_RETRIES:
                raise RuntimeError(f"Network error after {attempt} attempts: {exc}") from exc
            sleep_seconds = 2 ** attempt
            time.sleep(sleep_seconds)
            continue

        if response.status_code == 200:
            return response.json()

        if response.status_code in {429, 500, 502, 503, 504}:
            if attempt >= MAX_RETRIES:
                snippet = response.text[:240].replace("\n", " ")
                raise RuntimeError(
                    f"HTTP {response.status_code} after {attempt} attempts for {url}. Payload: {snippet}"
                )
            sleep_seconds = 2 ** attempt
            time.sleep(sleep_seconds)
            continue

        snippet = response.text[:240].replace("\n", " ")
        raise RuntimeError(f"HTTP {response.status_code} for {url}. Payload: {snippet}")

    raise RuntimeError(f"Unreachable retry state for {url}")


def normalize_number(value: Any) -> float | None:
    """Convert unknown numeric value to float when possible."""
    if value is None:
        return None
    try:
        parsed = float(value)
        if parsed != parsed:  # NaN check
            return None
        return parsed
    except (TypeError, ValueError):
        return None


def normalize_date(value: Any) -> str | None:
    """Normalize date-like values to YYYY-MM-DD."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.date().isoformat()
    except ValueError:
        if len(text) >= 10 and text[4] == "-" and text[7] == "-":
            return text[:10]
        return None


def normalize_history_rows(symbol: str, payload: Any) -> List[Dict[str, Any]]:
    """Normalize FMP /earnings rows for one symbol."""
    if not isinstance(payload, list):
        return []

    rows: List[Dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue

        eps_actual = normalize_number(item.get("epsActual", item.get("eps")))
        eps_estimate = normalize_number(item.get("epsEstimated", item.get("epsEstimate")))
        surprise_pct = normalize_number(
            item.get("epsSurprisePercent", item.get("surprisePercent", item.get("surprise")))
        )
        if surprise_pct is None and eps_actual is not None and eps_estimate not in (None, 0):
            surprise_pct = ((eps_actual - eps_estimate) / abs(eps_estimate)) * 100.0

        rows.append(
            {
                "source": "fmp_history",
                "symbol": symbol,
                "date": normalize_date(item.get("date") or item.get("fiscalDateEnding")),
                "period": item.get("period"),
                "calendar_year": item.get("calendarYear"),
                "quarter": item.get("quarter"),
                "eps_actual": eps_actual,
                "eps_estimate": eps_estimate,
                "eps_surprise_pct": surprise_pct,
                "revenue_actual": normalize_number(item.get("revenueActual", item.get("revenue"))),
                "revenue_estimate": normalize_number(item.get("revenueEstimated", item.get("revenueEstimate"))),
            }
        )
    return rows


def normalize_calendar_rows(payload: Any) -> List[Dict[str, Any]]:
    """Normalize FMP /earnings-calendar rows across symbols."""
    if not isinstance(payload, list):
        return []

    rows: List[Dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue

        symbol = str(item.get("symbol", "")).strip().upper()
        if not symbol:
            continue

        eps_actual = normalize_number(item.get("epsActual", item.get("eps")))
        eps_estimate = normalize_number(item.get("epsEstimated", item.get("epsEstimate")))
        surprise_pct = normalize_number(
            item.get("epsSurprisePercent", item.get("surprisePercent", item.get("surprise")))
        )
        if surprise_pct is None and eps_actual is not None and eps_estimate not in (None, 0):
            surprise_pct = ((eps_actual - eps_estimate) / abs(eps_estimate)) * 100.0

        rows.append(
            {
                "source": "fmp_calendar",
                "symbol": symbol,
                "date": normalize_date(item.get("date")),
                "period": item.get("period"),
                "calendar_year": item.get("calendarYear"),
                "quarter": item.get("quarter"),
                "eps_actual": eps_actual,
                "eps_estimate": eps_estimate,
                "eps_surprise_pct": surprise_pct,
                "revenue_actual": normalize_number(item.get("revenueActual", item.get("revenue"))),
                "revenue_estimate": normalize_number(item.get("revenueEstimated", item.get("revenueEstimate"))),
            }
        )
    return rows


def keep_latest_per_symbol(rows: Iterable[Dict[str, Any]], limit_per_symbol: int) -> List[Dict[str, Any]]:
    """Keep the latest N dated rows per symbol."""
    frame = pd.DataFrame(rows)
    if frame.empty:
        return []

    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.sort_values(["symbol", "date"], ascending=[True, False], na_position="last")
    frame = frame.groupby("symbol", as_index=False, sort=False).head(max(1, limit_per_symbol))
    frame["date"] = frame["date"].dt.strftime("%Y-%m-%d")
    return frame.to_dict(orient="records")


def main() -> int:
    """Run the earnings cache update workflow and persist CSV/JSON outputs."""
    args = parse_args()
    api_key = os.getenv("FMP_API_KEY", "").strip()
    if not api_key:
        print("ERROR: FMP_API_KEY is not set.", file=sys.stderr)
        return 2

    symbols = resolve_symbols(args.symbols)
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    end_date = (now + timedelta(days=max(1, args.days_forward))).date().isoformat()

    session = requests.Session()
    session.headers.update({"User-Agent": "ELDAR-Earnings-Updater/1.0"})

    calendar_url = (
        f"{FMP_BASE_URL}/earnings-calendar"
        f"?from={today}&to={end_date}&apikey={api_key}"
    )

    try:
        calendar_payload = request_with_backoff(calendar_url, session)
        calendar_rows = [
            row for row in normalize_calendar_rows(calendar_payload) if row["symbol"] in set(symbols)
        ]
    except RuntimeError as exc:
        print(f"WARN: calendar fetch failed: {exc}", file=sys.stderr)
        calendar_rows = []

    history_rows: List[Dict[str, Any]] = []
    for symbol in symbols:
        history_url = f"{FMP_BASE_URL}/earnings?symbol={symbol}&apikey={api_key}"
        try:
            payload = request_with_backoff(history_url, session)
            normalized = normalize_history_rows(symbol, payload)
            history_rows.extend(normalized)
        except RuntimeError as exc:
            print(f"WARN: history fetch failed for {symbol}: {exc}", file=sys.stderr)
            continue

    history_rows = keep_latest_per_symbol(history_rows, args.history_limit)
    all_rows = calendar_rows + history_rows
    frame = pd.DataFrame(all_rows)

    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    csv_path = out_prefix.with_suffix(".csv")
    json_path = out_prefix.with_suffix(".json")

    if frame.empty:
        frame = pd.DataFrame(
            columns=[
                "source",
                "symbol",
                "date",
                "period",
                "calendar_year",
                "quarter",
                "eps_actual",
                "eps_estimate",
                "eps_surprise_pct",
                "revenue_actual",
                "revenue_estimate",
            ]
        )

    frame.to_csv(csv_path, index=False)
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(frame.to_dict(orient="records"), handle, indent=2)

    print(
        f"OK: cached {len(frame)} rows | symbols={len(symbols)} | "
        f"calendar={len(calendar_rows)} | history={len(history_rows)} | "
        f"csv={csv_path} | json={json_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
