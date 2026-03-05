import { getRatingColor } from "@/components/share-cards/utils";
import type { ComparisonStock } from "@/components/share-cards/types";

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
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#666", marginBottom: 4 }}>
        <span>{label}</span>
        <span>
          {scoreA.toFixed(1)} vs {scoreB.toFixed(1)}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ height: 4, background: "#1A1A1A" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, (scoreA / maxValue) * 100))}%`, height: "100%", background: colorA }} />
        </div>
        <div style={{ height: 4, background: "#1A1A1A" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, (scoreB / maxValue) * 100))}%`, height: "100%", background: colorB }} />
        </div>
      </div>
    </div>
  );
}

function StockSide({ stock, align, isWinner }: { stock: ComparisonStock; align: "left" | "right"; isWinner: boolean }): JSX.Element {
  const ratingColor = getRatingColor(stock.rating);

  return (
    <div style={{ flex: 1, textAlign: align, opacity: isWinner ? 1 : 0.6 }}>
      {isWinner ? (
        <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#FFBF00", marginBottom: 8 }}>★ ELDAR PICK</div>
      ) : null}
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: "#F5F5F5", marginBottom: 4 }}>${stock.ticker}</div>
      <div style={{ fontSize: 10, color: "#444", marginBottom: 20 }}>{stock.name}</div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 48, fontWeight: 800, color: ratingColor, lineHeight: 1, marginBottom: 6 }}>
        {stock.score.toFixed(1)}
      </div>
      <div style={{ fontSize: 12, color: ratingColor, letterSpacing: "0.10em" }}>{stock.rating.replace("_", " ")}</div>
    </div>
  );
}

export function ComparisonCard({ stockA, stockB }: { stockA: ComparisonStock; stockB: ComparisonStock }): JSX.Element {
  const winner = stockA.score > stockB.score ? "A" : "B";
  const colorA = getRatingColor(stockA.rating);
  const colorB = getRatingColor(stockB.rating);

  return (
    <div
      style={{
        width: 1200,
        height: 628,
        background: "#000",
        border: "1px solid #1E1E1E",
        padding: "48px 56px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily: "'IBM Plex Mono', monospace"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#FFBF00" }}>ELDAR · HEAD TO HEAD</div>
        <div style={{ fontSize: 9, color: "#333", letterSpacing: "0.12em" }}>
          {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <StockSide stock={stockA} align="left" isWinner={winner === "A"} />

        <div style={{ width: 80, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "#222" }}>VS</div>
        </div>

        <StockSide stock={stockB} align="right" isWinner={winner === "B"} />
      </div>

      <div>
        <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#333", marginBottom: 14, textAlign: "center" }}>FACTOR COMPARISON</div>
        {["Fundamentals", "Momentum", "Valuation", "Sentiment"].map((factor, i) => (
          <ComparisonBar
            key={factor}
            label={factor}
            scoreA={stockA.factors[i]}
            scoreB={stockB.factors[i]}
            colorA={colorA}
            colorB={colorB}
          />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1A1A1A", paddingTop: 20 }}>
        <div style={{ fontSize: 9, color: "#2A2A2A", letterSpacing: "0.14em" }}>ELDAR · Think like an analyst.</div>
        <div style={{ fontSize: 9, color: "#2A2A2A", letterSpacing: "0.10em" }}>eldar.com</div>
      </div>
    </div>
  );
}
