import { StockDashboard } from "@/components/StockDashboard";
import { auth } from "@clerk/nextjs/server";
import { getRecentAnalyses, getWatchlist } from "@/lib/storage/index";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps): Promise<JSX.Element> {
  const { userId } = await auth();
  const params = await searchParams;
  const symbolRaw = params.symbol;
  const initialSymbol = Array.isArray(symbolRaw) ? symbolRaw[0] : symbolRaw;
  const [initialHistory, initialWatchlist] = await Promise.all([
    userId ? getRecentAnalyses(20, userId) : Promise.resolve([]),
    userId ? getWatchlist(userId) : Promise.resolve([])
  ]);

  return (
    <StockDashboard
      initialHistory={initialHistory}
      initialWatchlist={initialWatchlist}
      currentUserId={userId}
      initialSymbol={initialSymbol ?? null}
    />
  );
}
