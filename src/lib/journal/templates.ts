import type { JournalEntryType } from "@/lib/journal/types";

const THESIS_TEMPLATE = `## What I think happens

## Why the market is wrong

## Key drivers (3-5)
- 
- 
- 

## What would change my mind

## Catalysts + dates
- 

## Risk checklist
- 
`;

const EARNINGS_REVIEW_TEMPLATE = `## What mattered this quarter

## KPI delta vs last quarter

## Guidance signal

## Position change (if any)

## 1 thing to re-check next quarter
`;

const POSTMORTEM_TEMPLATE = `## Original thesis (link entry)

## What actually happened

## My mistake type

## Rule update (1 line)

## Next action
`;

const WATCHLIST_NOTE_TEMPLATE = `## What to monitor

## Trigger level(s)

## Why this belongs on watchlist
`;

const FREEFORM_TEMPLATE = `## Note

`;

export function getJournalTemplate(entryType: JournalEntryType): string {
  switch (entryType) {
    case "thesis":
      return THESIS_TEMPLATE;
    case "earnings_review":
      return EARNINGS_REVIEW_TEMPLATE;
    case "postmortem":
      return POSTMORTEM_TEMPLATE;
    case "watchlist_note":
      return WATCHLIST_NOTE_TEMPLATE;
    case "freeform":
    default:
      return FREEFORM_TEMPLATE;
  }
}
