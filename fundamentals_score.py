from __future__ import annotations

import argparse
import html
import json
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from statistics import mean
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pandas as pd
import yfinance as yf

WIKI_SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
DATAHUB_SP500_URL = "https://datahub.io/core/s-and-p-500-companies/r/constituents.csv"

SECTOR_PEERS: Dict[str, List[str]] = {
    "Technology": ["MSFT", "GOOGL", "NVDA"],
    "Financial Services": ["JPM", "BAC", "WFC"],
    "Healthcare": ["UNH", "JNJ", "ABBV"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD"],
    "Communication Services": ["GOOGL", "META", "NFLX"],
    "Consumer Defensive": ["WMT", "PG", "KO"],
    "Energy": ["XOM", "CVX", "COP"],
    "Utilities": ["NEE", "SO", "DUK"],
    "Real Estate": ["PLD", "AMT", "CCI"],
    "Industrials": ["GE", "CAT", "UNP"],
    "Basic Materials": ["LIN", "SHW", "NTR"],
}

SECTOR_ALIASES = {
    "Financial": "Financial Services",
    "Financials": "Financial Services",
    "Consumer Staples": "Consumer Defensive",
    "Consumer Discretionary": "Consumer Cyclical",
    "Communication": "Communication Services",
    "Materials": "Basic Materials",
}

DEFAULT_PEERS = ["MSFT", "AAPL", "GOOGL"]

METRIC_WEIGHTS = {
    "EPS Growth": 2.0,
    "P/E Ratio": 1.5,
    "FCF Yield": 1.5,
    "ROE": 1.0,
    "Debt/Equity": 1.0,
    "Gross Margin TTM": 1.0,
    "Buyback Yield": 1.0,
    "Revenue Growth": 0.5,
    "Insider Ownership": 0.5,
    "Current Ratio": 0.5,
}


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _to_yf_symbol(symbol: str) -> str:
    return _normalize_symbol(symbol).replace(".", "-")


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    try:
        return float(value)
    except Exception:
        return None


def _format_pct(value: Optional[float], digits: int = 2) -> str:
    if value is None:
        return "N/A"
    return f"{value * 100:.{digits}f}%"


def _format_num(value: Optional[float], digits: int = 2) -> str:
    if value is None:
        return "N/A"
    return f"{value:.{digits}f}"


def _format_billions(value: Optional[float]) -> str:
    if value is None:
        return "N/A"
    return f"${value / 1_000_000_000:.2f}B"


def _rating_for_score(score: float) -> str:
    if score >= 7.0:
        return "BUY"
    if score >= 4.0:
        return "HOLD"
    return "AVOID"


@lru_cache(maxsize=1)
def get_sp500_tickers() -> Tuple[str, ...]:
    sources: List[List[str]] = []

    try:
        table = pd.read_html(WIKI_SP500_URL)[0]
        symbols = [str(s).strip().upper() for s in table["Symbol"].tolist()]
        if symbols:
            sources.append(symbols)
    except Exception:
        pass

    try:
        csv_df = pd.read_csv(DATAHUB_SP500_URL)
        symbols = [str(s).strip().upper() for s in csv_df["Symbol"].tolist()]
        if symbols:
            sources.append(symbols)
    except Exception:
        pass

    for symbols in sources:
        unique_symbols = sorted({s for s in symbols if s})
        if len(unique_symbols) >= 450:
            return tuple(unique_symbols)

    merged = sorted({s for source in sources for s in source if s})
    return tuple(merged)


@lru_cache(maxsize=1)
def _sp500_lookup_set() -> set[str]:
    lookup: set[str] = set()
    for symbol in get_sp500_tickers():
        normalized = _normalize_symbol(symbol)
        lookup.add(normalized)
        lookup.add(normalized.replace(".", "-"))
        lookup.add(normalized.replace("-", "."))
    return lookup


def _is_sp500_ticker(symbol: str) -> bool:
    lookup = _sp500_lookup_set()
    if not lookup:
        # Fail-open if constituents list is temporarily unavailable.
        return True

    normalized = _normalize_symbol(symbol)
    return normalized in lookup or _to_yf_symbol(normalized) in lookup


@lru_cache(maxsize=1024)
def _cached_info(yf_symbol: str) -> Dict[str, Any]:
    stock = yf.Ticker(yf_symbol)
    try:
        data = stock.get_info()
    except Exception:
        data = stock.info
    return data if isinstance(data, dict) else {}


def _safe_frame(frame: Any) -> pd.DataFrame:
    if isinstance(frame, pd.DataFrame):
        return frame
    return pd.DataFrame()


def _row_series(frame: pd.DataFrame, names: Sequence[str]) -> Optional[pd.Series]:
    if frame.empty:
        return None
    index_map = {str(idx).strip().lower(): idx for idx in frame.index}
    for name in names:
        key = name.strip().lower()
        if key in index_map:
            series = frame.loc[index_map[key]]
            if isinstance(series, pd.Series):
                return series
    return None


def _series_values_desc(series: pd.Series) -> List[float]:
    clean = series.dropna()
    if clean.empty:
        return []
    try:
        clean = clean.sort_index(ascending=False)
    except Exception:
        pass
    values: List[float] = []
    for value in clean.tolist():
        parsed = _safe_float(value)
        if parsed is not None:
            values.append(parsed)
    return values


def _annual_gross_margins(income_stmt: pd.DataFrame) -> List[float]:
    gross_profit = _row_series(income_stmt, ["Gross Profit"])
    total_revenue = _row_series(income_stmt, ["Total Revenue", "Revenue"])
    if gross_profit is None or total_revenue is None:
        return []

    margins: List[Tuple[pd.Timestamp, float]] = []
    common_cols = [col for col in gross_profit.index if col in total_revenue.index]
    for col in common_cols:
        gp = _safe_float(gross_profit.get(col))
        rev = _safe_float(total_revenue.get(col))
        if gp is None or rev is None or rev <= 0:
            continue
        margin = gp / rev
        timestamp = pd.Timestamp(col)
        margins.append((timestamp, margin))

    margins.sort(key=lambda item: item[0], reverse=True)
    return [value for _, value in margins]


def _extract_free_cash_flow(info: Dict[str, Any], cashflow: pd.DataFrame) -> Optional[float]:
    info_fcf = _safe_float(info.get("freeCashflow"))
    if info_fcf is not None:
        return info_fcf

    fcf_row = _row_series(cashflow, ["Free Cash Flow", "FreeCashFlow"])
    if fcf_row is not None:
        values = _series_values_desc(fcf_row)
        if values:
            return values[0]

    ocf_row = _row_series(
        cashflow,
        [
            "Operating Cash Flow",
            "Total Cash From Operating Activities",
            "OperatingCashFlow",
        ],
    )
    capex_row = _row_series(cashflow, ["Capital Expenditure", "CapitalExpenditure"])

    if ocf_row is None or capex_row is None:
        return None

    ocf_values = _series_values_desc(ocf_row)
    capex_values = _series_values_desc(capex_row)
    if not ocf_values or not capex_values:
        return None

    ocf = ocf_values[0]
    capex = capex_values[0]
    return ocf + capex if capex < 0 else ocf - capex


def _debt_to_equity_percent(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if value <= 10:
        return value * 100
    return value


def _debt_equity_qoq_improving(quarterly_balance_sheet: pd.DataFrame) -> Optional[bool]:
    total_debt = _row_series(quarterly_balance_sheet, ["Total Debt"])
    equity = _row_series(
        quarterly_balance_sheet,
        [
            "Stockholders Equity",
            "Total Stockholder Equity",
            "Total Equity Gross Minority Interest",
        ],
    )

    if total_debt is None or equity is None:
        return None

    ratios: List[Tuple[pd.Timestamp, float]] = []
    common_cols = [col for col in total_debt.index if col in equity.index]
    for col in common_cols:
        debt_value = _safe_float(total_debt.get(col))
        equity_value = _safe_float(equity.get(col))
        if debt_value is None or equity_value is None or equity_value <= 0:
            continue
        ratios.append((pd.Timestamp(col), (debt_value / equity_value) * 100))

    ratios.sort(key=lambda item: item[0], reverse=True)
    if len(ratios) < 2:
        return None

    latest = ratios[0][1]
    prior = ratios[1][1]
    return latest < prior


def _shares_outstanding_decline_yoy(
    stock: yf.Ticker,
    info: Dict[str, Any],
    balance_sheet: pd.DataFrame,
) -> Optional[float]:
    try:
        start_date = (datetime.now(timezone.utc) - timedelta(days=900)).date().isoformat()
        shares_history = stock.get_shares_full(start=start_date)
    except Exception:
        shares_history = None

    if isinstance(shares_history, pd.Series) and not shares_history.dropna().empty:
        series = shares_history.dropna().sort_index()
        latest_date = series.index[-1]
        latest_shares = _safe_float(series.iloc[-1])
        if latest_shares is not None and latest_shares > 0:
            target_date = latest_date - pd.Timedelta(days=365)
            prior_candidates = series[series.index <= target_date]
            if not prior_candidates.empty:
                prior_shares = _safe_float(prior_candidates.iloc[-1])
                if prior_shares is not None and prior_shares > 0:
                    return (prior_shares - latest_shares) / prior_shares

    shares_row = _row_series(balance_sheet, ["Ordinary Shares Number", "Share Issued"])
    if shares_row is not None:
        shares_values = _series_values_desc(shares_row)
        if len(shares_values) >= 2 and shares_values[1] > 0:
            latest = shares_values[0]
            prior = shares_values[1]
            return (prior - latest) / prior

    current_shares = _safe_float(info.get("sharesOutstanding"))
    if current_shares is not None and current_shares > 0:
        implied_shares = _safe_float(info.get("impliedSharesOutstanding"))
        if implied_shares is not None and implied_shares > 0:
            return (implied_shares - current_shares) / implied_shares

    return None


def _buyback_announced(cashflow: pd.DataFrame) -> bool:
    buyback_row = _row_series(
        cashflow,
        [
            "Repurchase Of Capital Stock",
            "Common Stock Repurchased",
            "Repurchase Of Common Stock",
        ],
    )
    if buyback_row is None:
        return False

    values = _series_values_desc(buyback_row)
    if not values:
        return False

    latest = values[0]
    return latest != 0


def _resolve_sector(raw_sector: Optional[str]) -> str:
    if not raw_sector:
        return "Unknown"
    if raw_sector in SECTOR_PEERS:
        return raw_sector
    return SECTOR_ALIASES.get(raw_sector, raw_sector)


def _peer_list_for_sector(sector: str, exclude_symbol: str) -> List[str]:
    peers = list(SECTOR_PEERS.get(sector, DEFAULT_PEERS))
    cleaned: List[str] = []
    exclude_yf = _to_yf_symbol(exclude_symbol)

    for peer in peers + DEFAULT_PEERS:
        normalized = _normalize_symbol(peer)
        if _to_yf_symbol(normalized) == exclude_yf:
            continue
        if normalized not in cleaned:
            cleaned.append(normalized)
        if len(cleaned) == 3:
            break

    return cleaned


def _peer_average_forward_pe(peers: Sequence[str]) -> Optional[float]:
    values: List[float] = []
    for peer in peers:
        info = _cached_info(_to_yf_symbol(peer))
        pe = _safe_float(info.get("forwardPE"))
        if pe is not None and pe > 0:
            values.append(pe)
    if not values:
        return None
    return mean(values)


def _current_ratio(
    info: Dict[str, Any],
    quarterly_balance_sheet: pd.DataFrame,
    balance_sheet: pd.DataFrame,
) -> Optional[float]:
    ratio = _safe_float(info.get("currentRatio"))
    if ratio is not None:
        return ratio

    for frame in (quarterly_balance_sheet, balance_sheet):
        assets = _row_series(frame, ["Current Assets", "Total Current Assets"])
        liabilities = _row_series(frame, ["Current Liabilities", "Total Current Liabilities"])
        if assets is None or liabilities is None:
            continue

        asset_values = _series_values_desc(assets)
        liability_values = _series_values_desc(liabilities)
        if asset_values and liability_values and liability_values[0] > 0:
            return asset_values[0] / liability_values[0]

    return None


def _metric_entry(metric: str, score: float, passed: bool, value: str) -> Dict[str, Any]:
    return {
        "metric": metric,
        "score": round(score, 1),
        "pass": passed,
        "value": value,
    }


def _generate_widget_html(
    ticker: str,
    sector: str,
    total_score: float,
    rating: str,
    breakdown: Sequence[Dict[str, Any]],
) -> str:
    rating_colors = {"BUY": "#10B981", "HOLD": "#F59E0B", "AVOID": "#EF4444"}
    color = rating_colors.get(rating, "#6B7280")

    rows = []
    for item in breakdown:
        badge = "PASS" if item["pass"] else "FAIL"
        badge_bg = "#DCFCE7" if item["pass"] else "#FEE2E2"
        badge_fg = "#166534" if item["pass"] else "#991B1B"
        rows.append(
            "<tr>"
            f"<td style='padding:8px;border-bottom:1px solid #E5E7EB'>{html.escape(str(item['metric']))}</td>"
            f"<td style='padding:8px;border-bottom:1px solid #E5E7EB;text-align:right'>{item['score']:.1f}</td>"
            "<td style='padding:8px;border-bottom:1px solid #E5E7EB;text-align:center'>"
            f"<span style='padding:2px 8px;border-radius:999px;background:{badge_bg};color:{badge_fg};font-size:12px'>{badge}</span>"
            "</td>"
            f"<td style='padding:8px;border-bottom:1px solid #E5E7EB'>{html.escape(str(item['value']))}</td>"
            "</tr>"
        )

    return (
        "<div class='fundamentals-widget' "
        "style='font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;"
        "max-width:980px;border:1px solid #E5E7EB;border-radius:12px;padding:16px;background:#FFFFFF;'>"
        "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;'>"
        "<div>"
        f"<h3 style='margin:0;font-size:22px'>{html.escape(ticker)} Fundamentals Score</h3>"
        f"<p style='margin:4px 0 0;color:#6B7280'>Sector: {html.escape(sector)}</p>"
        "</div>"
        "<div style='text-align:right'>"
        f"<div style='font-size:30px;font-weight:700;color:{color}'>{total_score:.1f}/10</div>"
        f"<div style='font-size:14px;font-weight:600;color:{color}'>{html.escape(rating)}</div>"
        "</div>"
        "</div>"
        "<table style='width:100%;border-collapse:collapse;font-size:14px'>"
        "<thead>"
        "<tr style='background:#F9FAFB'>"
        "<th style='text-align:left;padding:8px;border-bottom:1px solid #E5E7EB'>Metric</th>"
        "<th style='text-align:right;padding:8px;border-bottom:1px solid #E5E7EB'>Score</th>"
        "<th style='text-align:center;padding:8px;border-bottom:1px solid #E5E7EB'>Status</th>"
        "<th style='text-align:left;padding:8px;border-bottom:1px solid #E5E7EB'>Value</th>"
        "</tr>"
        "</thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
        "<p style='margin-top:10px;color:#6B7280;font-size:12px'>"
        "Model bands: 0-3 AVOID, 4-6 HOLD, 7-10 BUY."
        "</p>"
        "</div>"
    )


def fundamentals_score(
    ticker: str,
    *,
    include_peer_scores: bool = True,
    validate_sp500: bool = True,
) -> Dict[str, Any]:
    """
    Fundamentals-only sector-agnostic score for S&P 500 stocks (0-10).

    Bands:
      - 0 to 3: AVOID
      - 4 to 6: HOLD
      - 7 to 10: BUY
    """

    if not ticker or not ticker.strip():
        raise ValueError("Ticker is required.")

    input_symbol = _normalize_symbol(ticker)
    yf_symbol = _to_yf_symbol(input_symbol)

    if validate_sp500 and not _is_sp500_ticker(input_symbol):
        raise ValueError(f"{input_symbol} is not recognized as an S&P 500 ticker.")

    stock = yf.Ticker(yf_symbol)
    info = _cached_info(yf_symbol)

    # Fail fast instead of silently scoring zeros when Yahoo data is unreachable.
    if not info:
        raise RuntimeError(
            f"Unable to fetch Yahoo Finance data for {input_symbol}. "
            "Check network/DNS access to finance.yahoo.com and related Yahoo hosts."
        )

    cashflow = _safe_frame(stock.cashflow)
    income_stmt = _safe_frame(stock.income_stmt)
    balance_sheet = _safe_frame(stock.balance_sheet)
    quarterly_balance_sheet = _safe_frame(stock.quarterly_balance_sheet)

    sector = _resolve_sector(info.get("sector"))
    peers = _peer_list_for_sector(sector, input_symbol)
    peer_avg_pe = _peer_average_forward_pe(peers)

    breakdown: List[Dict[str, Any]] = []

    # 1) EPS Growth (2.0 pts): +EPS TTM and forwardEPS > trailingEPS*1.08
    trailing_eps = _safe_float(info.get("trailingEps"))
    forward_eps = _safe_float(info.get("forwardEps"))
    eps_pass = (
        trailing_eps is not None
        and trailing_eps > 0
        and forward_eps is not None
        and forward_eps > trailing_eps * 1.08
    )
    breakdown.append(
        _metric_entry(
            "EPS Growth",
            METRIC_WEIGHTS["EPS Growth"] if eps_pass else 0.0,
            eps_pass,
            f"forwardEPS {_format_num(forward_eps)} vs trailingEPS {_format_num(trailing_eps)}",
        )
    )

    # 2) P/E Ratio (1.5 pts): forwardPE <25 OR < sector peer avg
    forward_pe = _safe_float(info.get("forwardPE"))
    pe_pass = bool(
        forward_pe is not None
        and (
            forward_pe < 25
            or (peer_avg_pe is not None and forward_pe < peer_avg_pe)
        )
    )
    breakdown.append(
        _metric_entry(
            "P/E Ratio",
            METRIC_WEIGHTS["P/E Ratio"] if pe_pass else 0.0,
            pe_pass,
            f"forwardPE {_format_num(forward_pe)} vs sectorPeerAvg {_format_num(peer_avg_pe)}",
        )
    )

    # 3) FCF Yield (1.5 pts): FCF / marketCap > 4% TTM
    market_cap = _safe_float(info.get("marketCap"))
    free_cash_flow = _extract_free_cash_flow(info, cashflow)
    fcf_yield = (
        (free_cash_flow / market_cap)
        if free_cash_flow is not None and market_cap is not None and market_cap > 0
        else None
    )
    fcf_pass = bool(fcf_yield is not None and fcf_yield > 0.04)
    breakdown.append(
        _metric_entry(
            "FCF Yield",
            METRIC_WEIGHTS["FCF Yield"] if fcf_pass else 0.0,
            fcf_pass,
            f"FCF {_format_billions(free_cash_flow)} / MktCap {_format_billions(market_cap)} = {_format_pct(fcf_yield)}",
        )
    )

    # 4) ROE (1.0 pt): returnOnEquity >18% TTM
    roe = _safe_float(info.get("returnOnEquity"))
    roe_pass = bool(roe is not None and roe > 0.18)
    breakdown.append(
        _metric_entry(
            "ROE",
            METRIC_WEIGHTS["ROE"] if roe_pass else 0.0,
            roe_pass,
            f"ROE {_format_pct(roe)}",
        )
    )

    # 5) Debt/Equity (1.0 pt): debtToEquity <100 OR quarter-over-quarter improving
    debt_to_equity_raw = _safe_float(info.get("debtToEquity"))
    debt_to_equity_pct = _debt_to_equity_percent(debt_to_equity_raw)
    de_qoq_improving = _debt_equity_qoq_improving(quarterly_balance_sheet)
    de_pass = bool(
        (debt_to_equity_pct is not None and debt_to_equity_pct < 100)
        or (de_qoq_improving is True)
    )
    breakdown.append(
        _metric_entry(
            "Debt/Equity",
            METRIC_WEIGHTS["Debt/Equity"] if de_pass else 0.0,
            de_pass,
            f"D/E {_format_num(debt_to_equity_pct)} | QoQ improving {de_qoq_improving}",
        )
    )

    # 6) Gross Margin TTM (1.0 pt): stable or up vs prior year
    gross_margin_ttm = _safe_float(info.get("grossMargins"))
    annual_margins = _annual_gross_margins(income_stmt)

    gross_pass = False
    gross_value = "Gross margin data unavailable"

    if gross_margin_ttm is not None and len(annual_margins) >= 2:
        prior = annual_margins[1]
        gross_pass = gross_margin_ttm >= (prior - 0.0025)
        gross_value = f"TTM {_format_pct(gross_margin_ttm)} vs priorYear {_format_pct(prior)}"
    elif len(annual_margins) >= 2:
        latest = annual_margins[0]
        prior = annual_margins[1]
        gross_pass = latest >= (prior - 0.0025)
        gross_value = f"Latest {_format_pct(latest)} vs priorYear {_format_pct(prior)}"

    breakdown.append(
        _metric_entry(
            "Gross Margin TTM",
            METRIC_WEIGHTS["Gross Margin TTM"] if gross_pass else 0.0,
            gross_pass,
            gross_value,
        )
    )

    # 7) Buyback Yield (1.0 pt): shares outstanding down >3% YoY OR buyback announced
    shares_decline = _shares_outstanding_decline_yoy(stock, info, balance_sheet)
    buyback_flag = _buyback_announced(cashflow)
    buyback_pass = bool((shares_decline is not None and shares_decline > 0.03) or buyback_flag)
    breakdown.append(
        _metric_entry(
            "Buyback Yield",
            METRIC_WEIGHTS["Buyback Yield"] if buyback_pass else 0.0,
            buyback_pass,
            f"Shares YoY {_format_pct(shares_decline)} | buybackAnnounced {buyback_flag}",
        )
    )

    # 8) Revenue Growth (0.5 pt): revenueGrowth >5% TTM
    revenue_growth = _safe_float(info.get("revenueGrowth"))
    rev_pass = bool(revenue_growth is not None and revenue_growth > 0.05)
    breakdown.append(
        _metric_entry(
            "Revenue Growth",
            METRIC_WEIGHTS["Revenue Growth"] if rev_pass else 0.0,
            rev_pass,
            f"Revenue growth {_format_pct(revenue_growth)}",
        )
    )

    # 9) Insider Ownership (0.5 pt): heldPercentInsiders >10%
    insider_ownership = _safe_float(info.get("heldPercentInsiders"))
    insider_pass = bool(insider_ownership is not None and insider_ownership > 0.10)
    breakdown.append(
        _metric_entry(
            "Insider Ownership",
            METRIC_WEIGHTS["Insider Ownership"] if insider_pass else 0.0,
            insider_pass,
            f"Held by insiders {_format_pct(insider_ownership)}",
        )
    )

    # 10) Current Ratio (0.5 pt): currentRatio >1.2
    current_ratio = _current_ratio(info, quarterly_balance_sheet, balance_sheet)
    current_ratio_pass = bool(current_ratio is not None and current_ratio > 1.2)
    breakdown.append(
        _metric_entry(
            "Current Ratio",
            METRIC_WEIGHTS["Current Ratio"] if current_ratio_pass else 0.0,
            current_ratio_pass,
            f"Current ratio {_format_num(current_ratio)}",
        )
    )

    total_score = round(sum(item["score"] for item in breakdown), 1)
    rating = _rating_for_score(total_score)

    peer_scores: Dict[str, Optional[float]] = {}
    if include_peer_scores:
        for peer in peers:
            try:
                peer_result = fundamentals_score(
                    peer,
                    include_peer_scores=False,
                    validate_sp500=False,
                )
                peer_scores[peer] = peer_result["total_score"]
            except Exception:
                peer_scores[peer] = None

    result: Dict[str, Any] = {
        "ticker": input_symbol,
        "total_score": total_score,
        "rating": rating,
        "sector": sector,
        "breakdown": breakdown,
        "peers": peer_scores,
    }

    result["widget_html"] = _generate_widget_html(
        ticker=input_symbol,
        sector=sector,
        total_score=total_score,
        rating=rating,
        breakdown=breakdown,
    )

    return result


def score_all_sp500(limit: Optional[int] = None) -> Dict[str, Dict[str, Any]]:
    symbols = list(get_sp500_tickers())
    if limit is not None:
        symbols = symbols[: max(limit, 0)]

    output: Dict[str, Dict[str, Any]] = {}
    for symbol in symbols:
        try:
            output[symbol] = fundamentals_score(
                symbol,
                include_peer_scores=False,
                validate_sp500=False,
            )
        except Exception as exc:
            output[symbol] = {"ticker": symbol, "error": str(exc)}
    return output


def rank_sp500(limit: Optional[int] = None) -> List[Tuple[str, float, str]]:
    rankings: List[Tuple[str, float, str]] = []
    batch = score_all_sp500(limit=limit)

    for symbol, payload in batch.items():
        if "error" in payload:
            continue

        total_score = _safe_float(payload.get("total_score"))
        rating = payload.get("rating")
        if total_score is None or not isinstance(rating, str):
            continue

        rankings.append((symbol, round(total_score, 1), rating))

    rankings.sort(key=lambda item: item[1], reverse=True)
    return rankings


def _main() -> None:
    parser = argparse.ArgumentParser(description="Fundamentals-only 10-point S&P 500 scorer")
    parser.add_argument("ticker", nargs="?", help="S&P 500 ticker (example: AAPL, XOM, JPM)")
    parser.add_argument("--batch-limit", type=int, default=None, help="Score first N S&P 500 symbols")
    parser.add_argument(
        "--rank",
        action="store_true",
        help="Output sorted (ticker, score, rating) rankings for S&P 500 symbols",
    )
    args = parser.parse_args()

    if args.ticker:
        print(json.dumps(fundamentals_score(args.ticker), indent=2))
        return

    if args.rank:
        print(json.dumps(rank_sp500(limit=args.batch_limit), indent=2))
        return

    batch = score_all_sp500(limit=args.batch_limit)
    print(json.dumps(batch, indent=2))


if __name__ == "__main__":
    _main()
