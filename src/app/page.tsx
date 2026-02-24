import { StockDashboard } from "@/components/StockDashboard";
import { auth } from "@clerk/nextjs/server";
import { getHomepageMag7Scores } from "@/lib/mag7";
import { getRecentAnalyses, getWatchlist } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<JSX.Element> {
  const { userId } = await auth();
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
    />
  );
}
