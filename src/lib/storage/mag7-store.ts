import { sql } from "@vercel/postgres";

import type { Mag7ScoreCard } from "@/lib/types";
import { ensureMag7Store, hasPostgres, readLocal, writeLocal } from "@/lib/storage/shared";

export async function saveMag7Scores(cards: Mag7ScoreCard[]): Promise<void> {
  if (hasPostgres) {
    await ensureMag7Store();

    for (const card of cards) {
      await sql`
        INSERT INTO mag7_scores (symbol, score, rating, payload, updated_at)
        VALUES (${card.symbol}, ${card.score}, ${card.rating}, ${JSON.stringify(card)}::jsonb, ${card.updatedAt})
        ON CONFLICT (symbol)
        DO UPDATE SET
          score = EXCLUDED.score,
          rating = EXCLUDED.rating,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      `;
    }
    return;
  }

  const db = await readLocal();
  const bySymbol = new Map(db.mag7Scores.map((row) => [row.symbol, row]));
  for (const card of cards) {
    bySymbol.set(card.symbol, card);
  }
  db.mag7Scores = Array.from(bySymbol.values());
  await writeLocal(db);
}

export async function getMag7Scores(): Promise<Mag7ScoreCard[]> {
  if (hasPostgres) {
    await ensureMag7Store();

    const { rows } = await sql<{ payload: Mag7ScoreCard }>`
      SELECT payload
      FROM mag7_scores
      ORDER BY score DESC, symbol ASC
    `;

    return rows.map((row) => row.payload).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  }

  const db = await readLocal();
  return [...db.mag7Scores].sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}
