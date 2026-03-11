export type PriceRange = "1W" | "1M" | "3M" | "1Y";

export interface PricePoint {
  time: string;
  price: number;
}

export interface PriceHistoryPayload {
  symbol: string;
  range: PriceRange;
  points: PricePoint[];
  changePercent: number | null;
}

export interface LiveQuoteRow {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

export interface LiveQuotePayload {
  quotes: LiveQuoteRow[];
  source: string;
  fetchedAt: string;
}
