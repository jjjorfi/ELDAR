/**
 * Central Redis key builders for backend cache and coordination primitives.
 */
export const REDIS_KEYS = {
  snapshot: (symbol: string): string => `eldar:snapshot:${symbol.toUpperCase()}`,
  quote: (symbol: string): string => `eldar:quote:${symbol.toUpperCase()}`,
  priceHistory: (symbol: string, range: string): string => `eldar:price-history:${symbol.toUpperCase()}:${range.toUpperCase()}`,
  liveQuotes: (symbols: string[]): string =>
    `eldar:quote-batch:${symbols.map((symbol) => symbol.toUpperCase()).sort().join(",")}`,
  userSession: (userId: string): string => `eldar:session:${userId}`,
  rateLimitApi: (ip: string): string => `eldar:ratelimit:api:${ip}`,
  marketStatus: (): string => "eldar:market:status",
  sectorSentiment: (window: string): string => `eldar:sector-sentiment:${window.toUpperCase()}`
} as const;
