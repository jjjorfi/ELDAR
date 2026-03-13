/**
 * Central Redis key builders for backend cache and coordination primitives.
 */
export const REDIS_KEYS = {
  snapshot: (symbol: string): string => `eldar:snapshot:${symbol.toUpperCase()}`,
  quote: (symbol: string): string => `eldar:quote:${symbol.toUpperCase()}`,
  priceHistory: (symbol: string, range: string): string => `eldar:price-history:${symbol.toUpperCase()}:${range.toUpperCase()}`,
  liveQuotes: (symbols: string[]): string =>
    `eldar:quote-batch:${symbols.map((symbol) => symbol.toUpperCase()).sort().join(",")}`,
  tvFundamentals: (ticker: string): string => `eldar:tv:fundamentals:${ticker.toUpperCase()}`,
  tvFundamentalsLastRun: (): string => "eldar:tv:fundamentals:last-run",
  tvFundamentalsCoverage: (): string => "eldar:tv:fundamentals:coverage",
  userSession: (userId: string): string => `eldar:session:${userId}`,
  rateLimitApi: (ip: string): string => `eldar:ratelimit:api:${ip}`,
  marketStatus: (): string => "eldar:market:status",
  sectorSentiment: (window: string): string => `eldar:sector-sentiment:${window.toUpperCase()}`,
  aiCache: (scope: string, model: string, promptHash: string): string =>
    `eldar:ai:cache:${scope}:${model}:${promptHash}`,
  aiDailyTokens: (userKey: string, dayKey: string): string =>
    `eldar:ai:tokens:${userKey}:${dayKey}`
} as const;
