"use client";

interface HeaderFeedStripProps {
  wrapperClassName?: string;
  shellClassName?: string;
  items?: string[];
}

const DEFAULT_ITEMS = ["US MARKETS", "EARNINGS CALENDAR", "SECTOR FLOW", "ELDAR ENGINE LIVE"];

export function HeaderFeedStrip({
  wrapperClassName = "relative hidden flex-1 items-center px-2 md:flex",
  shellClassName = "eldar-rss-shell w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
  items = DEFAULT_ITEMS
}: HeaderFeedStripProps): JSX.Element {
  return (
    <div className={wrapperClassName}>
      <div className={shellClassName}>
        <div className="flex min-h-[24px] items-center justify-center gap-4 px-3 text-[9px] uppercase tracking-[0.14em] text-white/60">
          {items.map((item) => (
            <span key={item} className="whitespace-nowrap">
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

