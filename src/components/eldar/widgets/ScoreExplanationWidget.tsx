import { DriversList } from "@/components/ui/AnalysisPrimitives";

interface ScoreExplanationWidgetProps {
  ratingNote: string;
  drivers: string[];
  risks: string[];
}

export function ScoreExplanationWidget({
  ratingNote,
  drivers,
  risks
}: ScoreExplanationWidgetProps): JSX.Element {
  return (
    <div className="space-y-4">
      <section className="eldar-panel rounded-3xl p-4">
        <p className="text-[10px] uppercase tracking-[0.14em] text-white/48">Score Explanation</p>
        <p className="mt-3 text-sm leading-relaxed text-white/84">{ratingNote}</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <DriversList title="Top Drivers" items={drivers} maxCollapsed={3} />
        <DriversList title="Risks" items={risks} maxCollapsed={3} tone="risks" />
      </div>
    </div>
  );
}

