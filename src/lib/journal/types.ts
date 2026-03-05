import type { RatingLabel } from "@/lib/types";

export type TradeStatus = "PLANNING" | "OPEN" | "CLOSED";
export type SetupQuality = "A" | "B" | "C";

export interface EldarSnapshot {
  capturedAt: string;
  modelVersion: string;
  score: number;
  rating: RatingLabel;
  topDrivers: string[];
}

export interface JournalEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TradeStatus;
  ticker: string;
  thesis: string;
  eldarSnapshot: EldarSnapshot;
  technicalSetup: string;
  fundamentalNote: string;
  marketContext: string;
  setupQuality: SetupQuality;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  positionSizePct: number | null;
  followedPlan: boolean | null;
  executionNotes: string;
  exitPrice: number | null;
  exitDate: string | null;
  returnPct: number | null;
  daysHeld: number | null;
  whatWentRight: string;
  whatWentWrong: string;
  wouldDoAgain: boolean | null;
  tags: string[];
  deletedAt: string | null;
}

export interface JournalListFilters {
  status?: TradeStatus | null;
  ticker?: string | null;
  q?: string | null;
  sort?: "createdAt" | "returnPct" | "setupQuality";
  direction?: "asc" | "desc";
  limit?: number;
}

export interface JournalReviewStats {
  winRate: number | null;
  avgWinner: number | null;
  avgLoser: number | null;
  bestSetup: { quality: SetupQuality; winRate: number | null } | null;
  worstHabit: { tag: string; count: number } | null;
  avgEldarOnWinners: number | null;
  avgEldarOnLosers: number | null;
  mostUsedTags: Array<{ tag: string; count: number }>;
  bestTags: Array<{ tag: string; avgReturn: number | null; count: number }>;
}

export interface JournalListResult {
  items: JournalEntry[];
  review: JournalReviewStats;
}

export interface JournalCreateInput {
  ticker: string;
  thesis: string;
  eldarSnapshot: EldarSnapshot;
}

export interface JournalUpdateInput {
  thesis?: string;
  technicalSetup?: string;
  fundamentalNote?: string;
  marketContext?: string;
  setupQuality?: SetupQuality;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  positionSizePct?: number | null;
  followedPlan?: boolean | null;
  executionNotes?: string;
  exitPrice?: number | null;
  exitDate?: string | null;
  whatWentRight?: string;
  whatWentWrong?: string;
  wouldDoAgain?: boolean | null;
  tags?: string[];
}
