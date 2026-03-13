"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildScoreExplanationFallbackSections,
  type ScoreExplanationSections
} from "@/lib/ai/score-explanation-shared";
import type { PersistedAnalysis } from "@/lib/types";

type ScoreExplanationApiResponse = {
  content: string;
  cached: boolean;
  model: string | null;
  source: "cache" | "provider" | "fallback";
  quotaRemaining: number | null;
  sections: ScoreExplanationSections;
};

export type ScoreExplanationState = {
  sections: ScoreExplanationSections | null;
  status: "idle" | "loading" | "ready";
  source: "cache" | "provider" | "fallback" | null;
};

/**
 * Resolves a score explanation through the single backend AI route.
 *
 * @param analysis - Current persisted analysis result or null.
 * @returns Structured explanation state for the UI controller.
 */
export function useScoreExplanation(analysis: PersistedAnalysis | null): ScoreExplanationState {
  const fallback = useMemo(
    () => (analysis ? buildScoreExplanationFallbackSections(analysis) : null),
    [analysis]
  );
  const [state, setState] = useState<ScoreExplanationState>({
    sections: fallback,
    status: analysis ? "loading" : "idle",
    source: fallback ? "fallback" : null
  });

  useEffect(() => {
    if (!analysis || !fallback) {
      setState({ sections: null, status: "idle", source: null });
      return;
    }

    const controller = new AbortController();
    setState({ sections: fallback, status: "loading", source: "fallback" });

    void (async () => {
      try {
        const response = await fetch("/api/ai/score-explanation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis }),
          signal: controller.signal,
          cache: "no-store"
        });

        if (!response.ok) {
          setState({ sections: fallback, status: "ready", source: "fallback" });
          return;
        }

        const payload = (await response.json()) as ScoreExplanationApiResponse;
        setState({
          sections: payload.sections,
          status: "ready",
          source: payload.source
        });
      } catch {
        if (!controller.signal.aborted) {
          setState({ sections: fallback, status: "ready", source: "fallback" });
        }
      }
    })();

    return () => controller.abort();
  }, [analysis, fallback]);

  return state;
}
