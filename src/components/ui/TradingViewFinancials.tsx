"use client";

import { memo, useEffect, useMemo, useRef } from "react";

const FINANCIALS_SCRIPT_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-financials.js";

const NASDAQ_SYMBOLS = new Set([
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "GOOG",
  "META",
  "TSLA",
  "NFLX",
  "AMD",
  "AVGO",
  "COST",
  "ADBE",
  "CSCO",
  "INTC",
  "QCOM",
  "PEP",
  "TMUS",
  "INTU",
  "AMGN",
  "ISRG",
  "BKNG",
  "PYPL",
  "ADP",
  "TXN",
  "MU"
]);

const NYSE_SYMBOLS = new Set([
  "BRK.B",
  "JPM",
  "V",
  "MA",
  "WMT",
  "XOM",
  "CVX",
  "JNJ",
  "PG",
  "HD",
  "UNH",
  "DIS",
  "BAC",
  "KO",
  "PFE",
  "ABBV",
  "CRM",
  "ORCL",
  "T",
  "VZ",
  "NKE",
  "IBM",
  "CAT",
  "GE",
  "GS",
  "MCD"
]);

type TradingViewFinancialsProps = {
  symbol: string;
  height?: number;
  className?: string;
};

function buildTradingViewSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.includes(":")) return normalized;
  if (NASDAQ_SYMBOLS.has(normalized)) return `NASDAQ:${normalized}`;
  if (NYSE_SYMBOLS.has(normalized) || normalized.includes(".")) return `NYSE:${normalized}`;
  return `NASDAQ:${normalized}`;
}

function TradingViewFinancialsComponent({
  symbol,
  height = 520,
  className
}: TradingViewFinancialsProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetSymbol = useMemo(() => buildTradingViewSymbol(symbol), [symbol]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.width = "100%";
    widget.style.height = "100%";

    const script = document.createElement("script");
    script.src = FINANCIALS_SCRIPT_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `
      {
        "symbol": "${widgetSymbol}",
        "colorTheme": "dark",
        "displayMode": "regular",
        "isTransparent": false,
        "locale": "en",
        "width": "100%",
        "height": ${height}
      }`;

    const copyright = document.createElement("div");
    copyright.className = "tradingview-widget-copyright mt-2 text-[10px]";
    copyright.innerHTML =
      `<a href="https://www.tradingview.com/symbols/${widgetSymbol.replace(":", "-")}/financials-overview/" rel="noopener nofollow" target="_blank"><span style="color:rgba(255,255,255,0.55)">${symbol.toUpperCase()} fundamentals</span></a><span style="color:rgba(255,255,255,0.35)"> by TradingView</span>`;

    container.appendChild(widget);
    container.appendChild(script);
    container.appendChild(copyright);

    return () => {
      container.replaceChildren();
    };
  }, [height, symbol, widgetSymbol]);

  return <div ref={containerRef} className={className} />;
}

export const TradingViewFinancials = memo(TradingViewFinancialsComponent);
