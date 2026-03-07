/* eslint-disable @next/next/no-img-element */

import { getRatingColor } from "@/components/share-cards/utils";
import type { ComparisonStock } from "@/components/share-cards/types";
import { ratingDisplayLabel } from "@/lib/rating";

function ComparisonBar({
  label,
  scoreA,
  scoreB,
  colorA,
  colorB
}: {
  label: string;
  scoreA: number;
  scoreB: number;
  colorA: string;
  colorB: string;
}): JSX.Element {
  const maxValue = Math.max(10, scoreA, scoreB);
  const widthA = `${Math.max(0, Math.min(100, (scoreA / maxValue) * 100))}%`;
  const widthB = `${Math.max(0, Math.min(100, (scoreB / maxValue) * 100))}%`;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#666", marginBottom: 4 }}>
        <span>{label}</span>
        <span>
          {scoreA.toFixed(1)} vs {scoreB.toFixed(1)}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ height: 4, background: "#1A1A1A" }}>
          <div style={{ width: widthA, height: "100%", background: colorA }} />
        </div>
        <div style={{ height: 4, background: "#1A1A1A" }}>
          <div style={{ width: widthB, height: "100%", background: colorB }} />
        </div>
      </div>
    </div>
  );
}

function StockColumn({
  stock,
  isWinner
}: {
  stock: ComparisonStock;
  isWinner: boolean;
}): JSX.Element {
  const color = getRatingColor(stock.rating);

  return (
    <div style={{ textAlign: "center", opacity: isWinner ? 1 : 0.68 }}>
      {isWinner ? (
        <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#FFBF00", marginBottom: 8 }}>ELDAR PICK</div>
      ) : null}
      <div style={{ fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace", fontSize: 34, fontWeight: 800, color: "#F5F5F5" }}>${stock.ticker}</div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{stock.name}</div>
      <div style={{ marginTop: 14, fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace", fontSize: 54, fontWeight: 800, color }}>{stock.score.toFixed(1)}</div>
      <div style={{ fontSize: 12, color, letterSpacing: "0.10em", marginTop: 6 }}>{ratingDisplayLabel(stock.rating)}</div>
    </div>
  );
}

export function ComparisonCard({ stockA, stockB }: { stockA: ComparisonStock; stockB: ComparisonStock }): JSX.Element {
  const winner = stockA.score >= stockB.score ? "A" : "B";
  const colorA = getRatingColor(stockA.rating);
  const colorB = getRatingColor(stockB.rating);

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
        <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "#FFBF00", marginBottom: 10 }}>ELDAR · HEAD TO HEAD</div>
      </div>

      <div style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 72px 1fr", alignItems: "center" }}>
        <StockColumn stock={stockA} isWinner={winner === "A"} />
        <div style={{ textAlign: "center", fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace", fontSize: 26, fontWeight: 800, color: "#2a2a2a" }}>VS</div>
        <StockColumn stock={stockB} isWinner={winner === "B"} />
      </div>

      <div style={{ width: "100%", maxWidth: 760, border: "1px solid #1E1E1E", background: "#0A0A0A", padding: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#666", marginBottom: 14, textAlign: "center" }}>FACTOR COMPARISON</div>
        {["Fundamentals", "Momentum", "Valuation", "Sentiment"].map((factor, index) => (
          <ComparisonBar
            key={factor}
            label={factor}
            scoreA={stockA.factors[index]}
            scoreB={stockB.factors[index]}
            colorA={colorA}
            colorB={colorB}
          />
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
