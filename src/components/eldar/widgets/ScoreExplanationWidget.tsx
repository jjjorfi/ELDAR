import { DriversList } from "@/components/ui/AnalysisPrimitives";
import type { ScoreExplanationSections } from "@/lib/ai/score-explanation-shared";

type ScoreExplanationWidgetProps = {
  sections: ScoreExplanationSections;
  status: "idle" | "loading" | "ready";
  source: "cache" | "provider" | "fallback" | null;
};

export function ScoreExplanationWidget({
  sections,
  status,
  source
}: ScoreExplanationWidgetProps): JSX.Element {
  return (
    <div className="space-y-4">
      <section className="eldar-panel rounded-3xl p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/48">Score Explanation</p>
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/38">
            {status === "loading" ? "Loading" : `AI ${source ?? "fallback"}`}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/84">{sections.conviction}</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DriversList title="Rationale" items={sections.rationale} maxCollapsed={3} />
        <DriversList title="Key Metrics" items={sections.keyMetrics} maxCollapsed={3} />
        <DriversList title="Risks" items={sections.risks} maxCollapsed={3} tone="risks" />
      </div>
    </div>
  );
}
