import OpenAI from "openai";
import {
  GeminiUnavailableError,
  getConfiguredGeminiApiKeys,
  getConfiguredGeminiModels,
  requestGemini,
} from "@/lib/gemini/client";
import {
  parseGeminiResponse,
  parseSuggestionText,
  type GeminiSuggestion,
} from "@/lib/gemini/parser";

export type GenerationProvider = "gemini" | "openrouter";

export type GenerationResult<T> = {
  value: T;
  provider: GenerationProvider;
  model: string;
};

type ProviderFailure = {
  provider: GenerationProvider;
  error: Error;
};

type OpenRouterFailureKind = "configuration" | "quota" | "capacity" | "model" | "other";

const DEFAULT_OPENROUTER_MODELS = [
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-26b-a4b-it:free",
  "openrouter/free",
];
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Both the primary provider and its configured fallback are unavailable. */
export class GenerationUnavailableError extends Error {
  readonly failures: ProviderFailure[];

  constructor(failures: ProviderFailure[]) {
    super(
      `All text-generation providers failed: ${failures
        .map(({ provider, error }) => `${provider}: ${error.message}`)
        .join("; ")}`,
    );
    this.name = "GenerationUnavailableError";
    this.failures = failures;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function extractGeminiText(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gemini response was empty or invalid.");
  }

  const response = raw as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { args?: Record<string, unknown> };
        }>;
      };
    }>;
  };
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  if (text) return text;

  const args = parts.find((part) => part.functionCall?.args)?.functionCall?.args;
  if (args) return JSON.stringify(args);
  throw new Error("Gemini response did not contain text.");
}

function getOpenRouterModels(): string[] {
  const configured = process.env.OPENROUTER_FREE_MODELS
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_OPENROUTER_MODELS;
}

function classifyOpenRouterFailure(error: Error): OpenRouterFailureKind {
  const message = error.message.toLowerCase();
  if (/api key|not configured|configuration failed|unauthorized|forbidden|\b401\b|\b403\b/.test(message)) {
    return "configuration";
  }
  if (/rate limit|quota|\b429\b/.test(message)) return "quota";
  if (/model.*(?:not found|unavailable)|\b404\b/.test(message)) return "model";
  if (/overloaded|unavailable|\b5\d\d\b/.test(message)) return "capacity";
  return "other";
}

async function requestOpenRouter(
  prompt: string,
  models: string[],
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  // A failed free-model request still counts against OpenRouter's daily quota.
  // Disable SDK retries because we explicitly move to the next model instead.
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    maxRetries: 0,
  });
  const failures: string[] = [];
  for (const model of models) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1024,
      });
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) throw new Error("response did not contain text");
      return { text, model: response.model || model };
    } catch (error) {
      const failure = asError(error);
      const kind = classifyOpenRouterFailure(failure);
      failures.push(`${model}: ${failure.message}`);
      if (kind === "configuration") {
        throw new Error(`OpenRouter configuration failed for ${model}: ${failure.message}`);
      }
      console.warn(
        `[Generation] OpenRouter model ${model} failed (${kind}); trying the next free model.`,
      );
    }
  }
  throw new Error(`All configured OpenRouter free models failed: ${failures.join("; ")}`);
}

async function generateWithFallback<T>(
  prompt: string,
  parseGemini: (raw: unknown) => T,
  parseText: (text: string) => T,
): Promise<GenerationResult<T>> {
  const failures: ProviderFailure[] = [];

  const geminiFailures: Error[] = [];
  const geminiModels = getConfiguredGeminiModels();
  // Flash-Lite is intentionally held until after the strongest available
  // OpenRouter model. This keeps normal generation quality-first, not merely
  // provider-first. The configured order is preserved within each tier.
  const primaryGeminiModels = geminiModels.filter((model) => !model.includes("-lite"));
  const liteGeminiModels = geminiModels.filter((model) => model.includes("-lite"));
  const openRouterModels = getOpenRouterModels();
  const [primaryOpenRouterModel, ...fallbackOpenRouterModels] = openRouterModels;
  let geminiConfigurationFailed = false;
  let openRouterConfigurationFailed = false;

  const tryGeminiModels = async (models: string[]): Promise<GenerationResult<T> | null> => {
    for (const model of models) {
      try {
        const raw = await requestGemini(prompt, model);
        return { value: parseGemini(raw), provider: "gemini", model };
      } catch (error) {
        const failure = asError(error);
        geminiFailures.push(failure);
        if (failure instanceof GeminiUnavailableError && failure.reason === "configuration") {
          geminiConfigurationFailed = true;
          console.warn("[Generation] Gemini configuration failed; skipping remaining Gemini models.");
          return null;
        }
        console.warn(`[Generation] Gemini model ${model} failed; trying the next candidate.`);
      }
    }
    return null;
  };

  let generated = await tryGeminiModels(primaryGeminiModels);
  if (generated) return generated;

  // The first configured OpenRouter model is the quality-tier bridge (Qwen by
  // default). It is tried before Gemini Lite; the remaining free models are
  // availability fallbacks after Gemini Lite.
  if (primaryOpenRouterModel) {
    try {
      const { text, model } = await requestOpenRouter(prompt, [primaryOpenRouterModel]);
      return {
        value: parseText(text),
        provider: "openrouter",
        model,
      };
    } catch (error) {
      const failure = asError(error);
      failures.push({ provider: "openrouter", error: failure });
      openRouterConfigurationFailed = classifyOpenRouterFailure(failure) === "configuration";
    }
  }

  if (!geminiConfigurationFailed) {
    generated = await tryGeminiModels(liteGeminiModels);
    if (generated) return generated;
  }

  const unavailableFailures = geminiFailures.filter(
    (error): error is GeminiUnavailableError => error instanceof GeminiUnavailableError,
  );
  const geminiError = unavailableFailures.length === geminiFailures.length
    ? new GeminiUnavailableError(
        unavailableFailures.at(-1)?.reason ?? "capacity",
        getConfiguredGeminiApiKeys().length,
        `All configured Gemini models failed: ${geminiFailures
          .map((error) => error.message)
          .join("; ")}`,
      )
    : new Error(
        `All configured Gemini models returned unusable results: ${geminiFailures
          .map((error) => error.message)
          .join("; ")}`,
      );
  failures.push({ provider: "gemini", error: geminiError });
  console.warn(`[Generation] Higher-priority generation candidates exhausted; trying remaining OpenRouter free models.`);

  if (!openRouterConfigurationFailed && fallbackOpenRouterModels.length > 0) {
    try {
      const { text, model } = await requestOpenRouter(prompt, fallbackOpenRouterModels);
      return {
        value: parseText(text),
        provider: "openrouter",
        model,
      };
    } catch (error) {
      failures.push({ provider: "openrouter", error: asError(error) });
    }
  }

  const providerUnavailable = failures.every(({ error }) =>
    error instanceof GeminiUnavailableError ||
    /(?:api key|not configured|permission|free tier|\b403\b|rate limit|\b429\b|\b503\b|unavailable|capacity)/i.test(error.message),
  );
  if (providerUnavailable) throw new GenerationUnavailableError(failures);

  throw new Error(
    `Text generation failed: ${failures
      .map(({ provider, error }) => `${provider}: ${error.message}`)
      .join("; ")}`,
  );
}

export function generateSuggestion(
  prompt: string,
): Promise<GenerationResult<GeminiSuggestion>> {
  return generateWithFallback(prompt, parseGeminiResponse, parseSuggestionText);
}

export function generateText(prompt: string): Promise<GenerationResult<string>> {
  return generateWithFallback(prompt, extractGeminiText, (text) => text);
}
