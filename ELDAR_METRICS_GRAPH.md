# ELDAR Metrics Graph

## 1) 10-Factor Weight Distribution (Total = 10.0)

```mermaid
pie showData
    title ELDAR Scoring Weights
    "EPS Beat (2.0)" : 2.0
    "Price > 200SMA (1.5)" : 1.5
    "RSI <50 (1.2)" : 1.2
    "Put/Call <0.9 (1.0)" : 1.0
    "FCF Yield >4% (1.0)" : 1.0
    "Short Interest <7% (0.8)" : 0.8
    "VIX <20 (0.7)" : 0.7
    "Revenue Growth >8% (0.6)" : 0.6
    "P/E < Sector (0.6)" : 0.6
    "Debt/Eq <75 (0.6)" : 0.6
```

## 2) How the ELDAR Score is Produced

```mermaid
flowchart LR
    A["Live Market Data"] --> B["10 Factor Engine"]

    B --> F1["EPS Beat\n0 to 2.0"]
    B --> F2["Price > 200SMA\n0 to 1.5"]
    B --> F3["RSI <50\n0 to 1.2"]
    B --> F4["Put/Call <0.9\n0 to 1.0"]
    B --> F5["FCF Yield >4%\n0 to 1.0"]
    B --> F6["Short Interest <7%\n0 to 0.8"]
    B --> F7["VIX <20\n0 to 0.7"]
    B --> F8["Revenue Growth >8%\n0 to 0.6"]
    B --> F9["P/E < Sector\n0 to 0.6"]
    B --> F10["Debt/Eq <75\n0 to 0.6"]

    F1 --> T["Total Score\n0.0 to 10.0"]
    F2 --> T
    F3 --> T
    F4 --> T
    F5 --> T
    F6 --> T
    F7 --> T
    F8 --> T
    F9 --> T
    F10 --> T

    T --> R1["0.0-3.9\n🐻 STRONGLY BEARISH\n#B91C1C"]
    T --> R2["4.0-5.9\n🔴 BEARISH\n#EF4444"]
    T --> R3["6.0-6.9\n⚪ NEUTRAL\n#6B7280"]
    T --> R4["7.0-8.9\n🟢 BULLISH\n#10B981"]
    T --> R5["9.0-10.0\n🐂 STRONGLY BULLISH\n#059669"]
```

## 3) Rating Bands (Quick Copy)

| Score Range | Label | Color |
|---|---|---|
| 0.0-3.9 | 🐻 STRONGLY BEARISH | `#B91C1C` |
| 4.0-5.9 | 🔴 BEARISH | `#EF4444` |
| 6.0-6.9 | ⚪ NEUTRAL | `#6B7280` |
| 7.0-8.9 | 🟢 BULLISH | `#10B981` |
| 9.0-10.0 | 🐂 STRONGLY BULLISH | `#059669` |
