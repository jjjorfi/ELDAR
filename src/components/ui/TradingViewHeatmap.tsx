"use client";

import { memo, useEffect, useRef } from "react";

const HEATMAP_SCRIPT_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js";

/**
 * Embeds TradingView's stock heatmap widget with a fixed SPX500 dataset.
 */
function TradingViewHeatmapComponent(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();

    const widgetRoot = document.createElement("div");
    widgetRoot.className = "tradingview-widget-container__widget";
    widgetRoot.style.height = "100%";
    widgetRoot.style.width = "100%";

    const script = document.createElement("script");
    script.src = HEATMAP_SCRIPT_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `
      {
        "dataSource": "SPX500",
        "blockSize": "market_cap_basic",
        "blockColor": "change",
        "grouping": "sector",
        "locale": "en",
        "symbolUrl": "",
        "colorTheme": "dark",
        "exchanges": [],
        "hasTopBar": false,
        "isDataSetEnabled": false,
        "isZoomEnabled": true,
        "hasSymbolTooltip": true,
        "isMonoSize": false,
        "width": "100%",
        "height": "100%"
      }`;

    const copyright = document.createElement("div");
    copyright.className = "tradingview-widget-copyright mt-2 text-[10px]";
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/heatmap/stock/" rel="noopener nofollow" target="_blank"><span style="color:rgba(255,255,255,0.55)">Stock Heatmap</span></a><span class="trademark" style="color:rgba(255,255,255,0.35)"> by TradingView</span>';

    container.appendChild(widgetRoot);
    container.appendChild(script);
    container.appendChild(copyright);

    return () => {
      container.replaceChildren();
    };
  }, []);

  return (
    <div
      className="tradingview-widget-container flex h-full min-h-[300px] flex-col"
      ref={containerRef}
    />
  );
}

export const TradingViewHeatmap = memo(TradingViewHeatmapComponent);
