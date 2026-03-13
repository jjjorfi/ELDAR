import { z } from "zod";

import { env } from "@/lib/env";
import { ExternalAPIError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";

const DEFAULT_MAX_TOKENS = 300;
const DEFAULT_TEMPERATURE = 0.2;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 250;
const PROVIDER_TIMEOUT_MS = 8_000;

const ChatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().min(1)
      })
    })
  ).min(1)
});

export type AIModelTier = "small" | "large";

export type AICompletionOptions = {
  modelTier?: AIModelTier;
  maxTokens?: number;
  temperature?: number;
};

function completionUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a single OpenAI-compatible Hugging Face chat completion request.
 *
 * @param system - System prompt content.
 * @param user - User prompt content.
 * @param options - Provider override options.
 * @returns Assistant message content only.
 */
export async function requestAICompletion(
  system: string,
  user: string,
  options: AICompletionOptions = {}
): Promise<{ content: string; model: string }> {
  if (!env.HF_API_KEY) {
    throw new ExternalAPIError("huggingface", "HF_API_KEY is not configured");
  }

  const model = options.modelTier === "large" ? env.HF_MODEL_LARGE : env.HF_MODEL_SMALL;
  const maxTokens = Math.min(options.maxTokens ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS);
  const temperature = Math.min(options.temperature ?? DEFAULT_TEMPERATURE, DEFAULT_TEMPERATURE);
  const url = completionUrl(env.HF_BASE_URL);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.HF_API_KEY}`
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }),
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const retryable = [429, 502, 503].includes(response.status);
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        throw new ExternalAPIError("huggingface", `HTTP ${response.status}`, {
          body: body.slice(0, 300),
          attempt,
          model
        });
      }

      const parsed = ChatCompletionResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ValidationError("Invalid Hugging Face completion payload", {
          issues: parsed.error.flatten()
        });
      }

      return {
        content: parsed.data.choices[0].message.content.trim(),
        model
      };
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof ExternalAPIError
          ? false
          : error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);

      if (retryable && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  log({
    level: "warn",
    service: "ai-provider",
    message: "AI provider request failed",
    error: lastError instanceof Error ? lastError.message : "Unknown AI provider error"
  });

  if (lastError instanceof ExternalAPIError || lastError instanceof ValidationError) {
    throw lastError;
  }

  throw new ExternalAPIError(
    "huggingface",
    lastError instanceof Error ? lastError.message : "Unknown provider failure"
  );
}
