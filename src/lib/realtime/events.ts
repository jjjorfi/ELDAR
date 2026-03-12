// File Purpose:
// - Defines shared Socket.IO event names, room naming helpers, and payload contracts.
// - Used by BOTH Next.js API routes (publishers) and frontend listeners.
//
// Integration Points:
// - /Users/s.bahij/Documents/ELDAR SaaS/src/lib/realtime/publisher.ts (server-side emit calls)
// - /Users/s.bahij/Documents/ELDAR SaaS/src/hooks/useSocket.ts (client heartbeat + connection)
// - /Users/s.bahij/Documents/ELDAR SaaS/src/components/StockDashboard.tsx (watchlist delta listener)
// - /Users/s.bahij/Documents/ELDAR SaaS/realtime-server/server.js (socket server routing)
//
// Gotchas:
// - Keep event names stable; changing them will silently break realtime updates.
// - Rooms are security boundaries. Always emit user-private data to user rooms only.

export const SOCKET_EVENTS = {
  WATCHLIST_UPDATED: "watchlist:updated",
  MARKET_MOVERS_UPDATED: "market-movers:updated",
  INDICES_YTD_UPDATED: "indices-ytd:updated",
  EARNINGS_UPDATED: "earnings:updated",
  MAG7_UPDATED: "mag7:updated",
  QUOTE_TICKS_UPDATED: "price-ticks:updated",
  HEARTBEAT_PING: "heartbeat:ping",
  HEARTBEAT_PONG: "heartbeat:pong"
} as const;

export type WatchlistDeltaAction = "added" | "removed";

export interface WatchlistDeltaPayload {
  userId: string;
  orgId: string | null;
  symbol: string;
  action: WatchlistDeltaAction;
  changedAt: string;
}

export interface MarketMoversPayload {
  movers: Array<{
    symbol: string;
    companyName: string;
    currentPrice: number | null;
    changePercent: number | null;
  }>;
}

export interface IndicesYtdPayload {
  indices: Array<{
    code: "US2000" | "US100" | "US500";
    label: string;
    symbol: string;
    current: number | null;
    ytdChangePercent: number | null;
    asOf: string | null;
    points: number[];
  }>;
}

export interface EarningsPayload {
  upcoming: Array<{
    symbol: string;
    companyName: string;
    date: string | null;
    epsEstimate: number | null;
  }>;
}

export interface Mag7Payload {
  cards: Array<{
    symbol: string;
    companyName: string;
    score: number;
    rating: string;
    currentPrice: number;
    changePercent: number | null;
    updatedAt: string;
  }>;
  marketOpen: boolean | null;
}

export interface QuoteTicksPayload {
  source: "ALPACA_STREAM";
  emittedAt: string;
  updates: Array<{
    symbol: string;
    price: number;
    asOfMs: number;
  }>;
}

export const SOCKET_ROOMS = {
  user(userId: string): string {
    return `user:${userId}`;
  },
  org(orgId: string): string {
    return `org:${orgId}`;
  },
  publicDashboard(): string {
    return "public:dashboard";
  }
};
