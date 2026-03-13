import { getCachedAIResponse, setCachedAIResponse, type AICacheOptions } from "@/lib/ai/cache";
import { requestAICompletion, type AICompletionOptions } from "@/lib/ai/provider";
import { estimateTokens, enforceDailyAITokenQuota } from "@/lib/ai/token-limiter";
import { log } from "@/lib/logger";

export type GeneratedAnswer = {
  content: string;
  cached: boolean;
  model: string | null;
  source: "cache" | "provider" | "fallback";
  quotaRemaining: number | null;
};

export type GenerateAnswerOptions = {
  userKey: string;
  cache: AICacheOptions;
  system: string;
  userPrompt: string;
  provider?: AICompletionOptions;
  fallback: () => string;
};

/**
 * Runs the single governed AI request path for the application.
 *
 * Cache is checked first, quota is enforced before provider execution, and the
 * deterministic fallback is used whenever the provider path fails.
 *
 * @param options - Controlled AI generation settings.
 * @returns Generated or cached response metadata.
 */
export async function generateAnswerForUser(options: GenerateAnswerOptions): Promise<GeneratedAnswer> {
  const cached = await getCachedAIResponse(options.cache);
  if (cached) {
    return {
      content: cached,
      cached: true,
      model: options.cache.model,
      source: "cache",
      quotaRemaining: null
    };
  }

  const estimatedTokens =
    estimateTokens(options.system) + estimateTokens(options.userPrompt) + (options.provider?.maxTokens ?? 300);

  try {
    const quotaRemaining = await enforceDailyAITokenQuota(options.userKey, estimatedTokens);
    const completion = await requestAICompletion(options.system, options.userPrompt, options.provider);
    await setCachedAIResponse(options.cache, completion.content);

    return {
      content: completion.content,
      cached: false,
      model: completion.model,
      source: "provider",
      quotaRemaining
    };
  } catch (error) {
    log({
      level: "warn",
      service: "ai-generate",
      message: "AI provider path failed; serving deterministic fallback",
      error: error instanceof Error ? error.message : "Unknown AI generation error",
      scope: options.cache.scope
    });

    return {
      content: options.fallback(),
      cached: false,
      model: null,
      source: "fallback",
      quotaRemaining: null
    };
  }
}
