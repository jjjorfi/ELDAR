import { AdapterError, defaultProvenance, parseDateOnly, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkPrice } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalChartHistory, ChartInterval } from "@/lib/normalize/types/canonical";
import type { YahooChartBarRaw } from "@/lib/normalize/types/providers";

export function normalizeYahooChartHistory(
  tickerInput: string,
  interval: ChartInterval,
  rawBars: YahooChartBarRaw[],
  fetchedAt: string
): CanonicalChartHistory {
  const ticker = toUpperTicker(tickerInput);

  const warnings: string[] = [];
  const bars = rawBars
    .map((bar) => {
      const date = parseDateOnly(bar.date);
      const close = bar.close ?? null;
      const adjClose = bar.adjClose ?? close;
      const open = bar.open ?? null;
      const high = bar.high ?? null;
      const low = bar.low ?? null;
      const volume = bar.volume ?? null;

      if (!date || close == null || adjClose == null || open == null || high == null || low == null || volume == null) {
        return null;
      }

      const closeCheck = checkPrice(adjClose, { ticker });
      if (!closeCheck.ok || closeCheck.value == null) {
        warnings.push(`${date}: invalid adjClose (${closeCheck.reason ?? "unknown"})`);
        return null;
      }

      return {
        date,
        open,
        high,
        low,
        close,
        adjClose: closeCheck.value,
        volume: Math.max(0, Math.trunc(volume))
      };
    })
    .filter((bar): bar is NonNullable<typeof bar> => bar !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bars.length === 0) {
    throw new AdapterError(`Yahoo ${ticker}: no valid bars after normalization`);
  }

  return {
    ticker,
    interval,
    bars,
    meta: defaultProvenance("yahoo", fetchedAt, {
      delayMins: 15,
      warnings
    })
  };
}
