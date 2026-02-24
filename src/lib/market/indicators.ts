interface HistoryPoint {
  date: Date;
  close: number | null;
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / period;
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const series: number[] = [values[0]];

  for (let i = 1; i < values.length; i += 1) {
    const next = (values[i] - series[i - 1]) * multiplier + series[i - 1];
    series.push(next);
  }

  return series;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(values: number[]): { line: number | null; signal: number | null } {
  if (values.length < 35) {
    return { line: null, signal: null };
  }

  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdSeries: number[] = [];

  for (let i = 0; i < values.length; i += 1) {
    macdSeries.push(ema12[i] - ema26[i]);
  }

  const signalSeries = ema(macdSeries, 9);

  return {
    line: macdSeries[macdSeries.length - 1] ?? null,
    signal: signalSeries[signalSeries.length - 1] ?? null
  };
}

export function monthSeasonalityRatio(monthlyHistory: HistoryPoint[]): { ratio: number | null; sampleSize: number } {
  const sorted = monthlyHistory
    .filter((entry) => typeof entry.close === "number" && entry.close !== null)
    .sort((a, b) => +a.date - +b.date);

  if (sorted.length < 24) {
    return { ratio: null, sampleSize: 0 };
  }

  const now = new Date();
  const targetMonth = now.getMonth();
  const minYear = now.getFullYear() - 10;
  let positiveCount = 0;
  let sampleSize = 0;

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const previous = sorted[i - 1];

    if (!current.close || !previous.close) {
      continue;
    }

    const year = current.date.getFullYear();
    const month = current.date.getMonth();

    if (year < minYear || month !== targetMonth) {
      continue;
    }

    const monthlyReturn = (current.close - previous.close) / previous.close;

    if (monthlyReturn > 0) {
      positiveCount += 1;
    }

    sampleSize += 1;
  }

  if (sampleSize === 0) {
    return { ratio: null, sampleSize: 0 };
  }

  return {
    ratio: positiveCount / sampleSize,
    sampleSize
  };
}
