import { StockDashboard } from "@/components/StockDashboard";
import { auth } from "@clerk/nextjs/server";
import { getHomepageMag7Scores } from "@/lib/mag7";
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
  const [initialHistory, initialWatchlist, initialMag7Scores] = await Promise.all([
    userId ? getRecentAnalyses(20, userId) : Promise.resolve([]),
    userId ? getWatchlist(userId) : Promise.resolve([]),
    getHomepageMag7Scores()
  ]);

  return (
    <StockDashboard
      initialHistory={initialHistory}
      initialWatchlist={initialWatchlist}
      initialMag7Scores={initialMag7Scores}
      currentUserId={userId}
      initialSymbol={initialSymbol ?? null}
    />
  );
}
