export type JournalEntryType =
  | "freeform"
  | "thesis"
  | "earnings_review"
  | "postmortem"
  | "watchlist_note";

export type JournalSentiment = "bull" | "bear" | "neutral";
export type JournalTimeHorizon = "weeks" | "months" | "years";
export type JournalStatus = "draft" | "final";

export interface JournalEntrySymbol {
  symbol: string;
  primary: boolean;
}

export interface JournalEntry {
  id: string;
  userId: string;
  title: string;
  contentMd: string;
  contentPlain: string;
  entryType: JournalEntryType;
  sentiment: JournalSentiment | null;
  conviction: number | null;
  timeHorizon: JournalTimeHorizon | null;
  status: JournalStatus;
  symbols: JournalEntrySymbol[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface JournalEntryListFilters {
  symbol?: string | null;
  tag?: string | null;
  type?: JournalEntryType | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  status?: JournalStatus | null;
  limit?: number;
  cursor?: string | null;
}

export interface JournalListResult {
  items: JournalEntry[];
  nextCursor: string | null;
  insights: {
    symbol: string | null;
    lastThesis: JournalEntry | null;
    lastEarningsReview: JournalEntry | null;
    openDrafts: JournalEntry[];
  };
}

export interface JournalUpsertInput {
  title: string;
  contentMd: string;
  entryType: JournalEntryType;
  sentiment?: JournalSentiment | null;
  conviction?: number | null;
  timeHorizon?: JournalTimeHorizon | null;
  status?: JournalStatus;
  symbols?: JournalEntrySymbol[];
  tags?: string[];
}
