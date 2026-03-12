import { AdapterError, defaultProvenance, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkPrice } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalChartHistory, ChartInterval } from "@/lib/normalize/types/canonical";

function parseCsvLine(line: string): string[] {
  return line.split(",").map((item) => item.trim());
}

export function normalizeStooqCsvHistory(
  tickerInput: string,
  interval: ChartInterval,
  csv: string,
  fetchedAt: string
): CanonicalChartHistory {
  const ticker = toUpperTicker(tickerInput);
  const warnings: string[] = [];

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    throw new AdapterError(`Stooq ${ticker}: CSV is empty`);
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = {
    date: header.indexOf("date"),
    open: header.indexOf("open"),
    high: header.indexOf("high"),
    low: header.indexOf("low"),
    close: header.indexOf("close"),
    volume: header.indexOf("volume")
  };

  if (Object.values(idx).some((v) => v < 0)) {
    throw new AdapterError(`Stooq ${ticker}: missing required CSV columns`);
  }

  const bars = lines
    .slice(1)
    .map((line) => {
      const parts = parseCsvLine(line);
      const date = parts[idx.date] ?? null;
      const open = Number.parseFloat(parts[idx.open] ?? "");
      const high = Number.parseFloat(parts[idx.high] ?? "");
      const low = Number.parseFloat(parts[idx.low] ?? "");
      const close = Number.parseFloat(parts[idx.close] ?? "");
      const volume = Number.parseInt(parts[idx.volume] ?? "", 10);

      if (!date || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        warnings.push(`invalid row ignored: ${line}`);
        return null;
      }

      const closeCheck = checkPrice(close, { ticker });
      if (!closeCheck.ok || closeCheck.value == null) {
        warnings.push(`invalid close for ${date}: ${closeCheck.reason ?? "unknown"}`);
        return null;
      }

      return {
        date,
        open,
        high,
        low,
        close,
        adjClose: closeCheck.value,
        volume: Number.isFinite(volume) ? Math.max(0, volume) : 0
      };
    })
    .filter((bar): bar is NonNullable<typeof bar> => bar !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.length === 0) {
    throw new AdapterError(`Stooq ${ticker}: no valid bars after normalization`);
  }

  return {
    ticker,
    interval,
    bars,
    meta: defaultProvenance("stooq", fetchedAt, {
      delayMins: 15,
      warnings
    })
  };
}
