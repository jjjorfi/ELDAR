/* eslint-disable @next/next/no-img-element */

import { scoreCircle, getRatingColor } from "@/components/share-cards/utils";
import type { PortfolioXRayCardProps } from "@/components/share-cards/types";
import { ratingDisplayLabel } from "@/lib/rating";

export function PortfolioXRayCard({
  portfolioName,
  compositeScore,
  stars,
  rating,
  topHoldings,
  strongBuyPct,
  strongSellPct,
  peerGroup
}: PortfolioXRayCardProps): JSX.Element {
  const ratingColor = getRatingColor(rating);

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        background: "#000",
        border: "1px solid #1E1E1E",
        padding: "64px 72px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 36,
        fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace"
      }}
    >
      <div style={{ textAlign: "center", width: "100%" }}>
        <img
          src="/brand/eldar-logo.png"
          alt="ELDAR"
          style={{ width: 92, height: 92, objectFit: "contain", margin: "0 auto 22px" }}
        />
        <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "#FFBF00", marginBottom: 10 }}>PORTFOLIO SIGNAL</div>
        <div
          style={{
            fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
            fontSize: 44,
            fontWeight: 800,
            color: "#F5F5F5",
            letterSpacing: "-0.02em"
          }}
        >
          {portfolioName}
        </div>
        <div style={{ fontSize: 13, color: "#666", marginTop: 8, letterSpacing: "0.12em" }}>{peerGroup.toUpperCase()}</div>
      </div>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ fontSize: 42, letterSpacing: 5, color: "#FFBF00", marginBottom: 16 }}>
          {"★".repeat(stars)}{"☆".repeat(5 - stars)}
        </div>
        {scoreCircle(compositeScore, rating, 240)}
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
              fontSize: 62,
              fontWeight: 800,
              color: ratingColor,
              lineHeight: 1,
              marginBottom: 12,
              letterSpacing: "-0.02em"
            }}
          >
            {ratingDisplayLabel(rating)}
          </div>
          <div style={{ fontSize: 16, color: "#7a7a7a" }}>Composite score {compositeScore.toFixed(1)} / 10</div>
        </div>

        <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 26 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#10B981" }}>{strongBuyPct}%</div>
            <div style={{ fontSize: 11, color: "#666", letterSpacing: "0.12em" }}>STRONGLY BULLISH</div>
          </div>
          <div style={{ width: 1, height: 36, background: "#1f1f1f" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#EF4444" }}>{strongSellPct}%</div>
            <div style={{ fontSize: 11, color: "#666", letterSpacing: "0.12em" }}>STRONGLY BEARISH</div>
          </div>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 760 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", color: "#666", marginBottom: 20, textAlign: "center" }}>TOP HOLDINGS</div>
        {topHoldings.slice(0, 5).map((h, i) => (
          <div
            key={`${h.ticker}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 0",
              borderBottom: "1px solid #111"
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#F5F5F5" }}>${h.ticker}</span>
              <span style={{ fontSize: 12, color: "#666" }}>{h.weight.toFixed(1)}%</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 150, height: 4, background: "#1A1A1A" }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, (h.score / 10) * 100))}%`,
                    height: "100%",
                    background: getRatingColor(h.rating)
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: getRatingColor(h.rating),
                  minWidth: 42,
                  textAlign: "right"
                }}
              >
                {h.score.toFixed(1)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "#2A2A2A", letterSpacing: "0.14em" }}>ELDAR · Think like an analyst.</div>
        <div style={{ fontSize: 10, color: "#2A2A2A", letterSpacing: "0.10em" }}>
          {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
        </div>
      </div>
    </div>
  );
}
