import { randomUUID } from "node:crypto";
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

export type GenerationProvider = "opencode" | "gemini" | "openrouter";

export type GenerationResult<T> = {
  value: T;
  provider: GenerationProvider;
  model: string;
};

type ProviderFailure = {
  provider: GenerationProvider;
  error: Error;
};

type ChatFailureKind = "configuration" | "quota" | "capacity" | "model" | "other";

type ChatProviderConfig = {
  /** Human-readable provider name used in logs and thrown messages. */
  label: string;
  apiKey: string;
  baseURL: string;
  maxTokens: (model: string) => number;
  headers?: Record<string, string>;
};

/**
 * OpenCode Go is a paid monthly-allowance gateway with an OpenAI-compatible
 * endpoint, so it leads the fallback chain whenever its key is configured.
 *
 * Order is measured quality first, not price first. Three samples per model on
 * the real prompt (2026-10-30, 140-char Japanese post):
 *
 *   claude-haiku-5-5      7s   $0.0007/post   best nuance, clean JSON
 *   glm-5.3-flash         3.5s $0.0001/post   clean JSON, shorter and more formulaic
 *   gpt-6-luna            7s   $0.0003/post   distinct angles, slightly verbose
 *   deepseek-v4.1-flash  25s   $0.0015/post   reasoning model: 2-3k hidden tokens
 *
 * `deepseek-v4.1-flash` looks cheap per token but spends 2-3k reasoning tokens
 * on a 100-character post, which makes it both slower and ~10x the cost of
 * glm-5.3-flash here. It stays last, with a token budget large enough to finish.
 */
const DEFAULT_OPENCODE_MODELS = [
  "claude-haiku-5-5",
  "glm-5.3-flash",
  "gpt-6-luna",
  "deepseek-v4.1-flash",
];
const OPENCODE_DEFAULT_MAX_TOKENS = 2048;
/** Reasoning-capable models emit hidden tokens before the JSON answer. */
const OPENCODE_MAX_TOKENS_BY_MODEL: Record<string, number> = {
  "claude-haiku-5-5": 4096,
  "gpt-6-luna": 4096,
  "gpt-5.6-luna": 4096,
  "deepseek-v4.1-flash": 8192,
  "deepseek-v4-pro": 8192,
};
const OPENCODE_BASE_URL = "https://opencode.ai/inference/go/openai/v1";
/** OpenCode asks clients to identify themselves instead of using a generic SDK UA. */
const OPENCODE_USER_AGENT = "tweets-autogen/1.0";
/** One stable id per process so OpenCode can route and cache this batch. */
const OPENCODE_SESSION_ID = randomUUID();

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

/** OpenCode Go models, ordered from the best default to availability fallbacks. */
export function getOpencodeModels(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const configured = env.OPENCODE_GO_MODELS
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_OPENCODE_MODELS;
}

/**
 * Output-token budget for one OpenCode Go model. Reasoning models need room for
 * the hidden reasoning plus the JSON answer; a shared cap silently truncates
 * them to an empty `content`, which reads as a failed generation.
 */
export function getOpencodeMaxTokens(model: string): number {
  return OPENCODE_MAX_TOKENS_BY_MODEL[model] ?? OPENCODE_DEFAULT_MAX_TOKENS;
}

export function getOpencodeApiKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const key = env.OPENCODE_GO_API_KEY?.trim();
  return key ? key : null;
}

function classifyChatFailure(error: Error): ChatFailureKind {
  const message = error.message.toLowerCase();
  if (/api key|not configured|configuration failed|unauthorized|forbidden|\b401\b|\b403\b/.test(message)) {
    return "configuration";
  }
  if (/rate limit|quota|allowance|\b429\b/.test(message)) return "quota";
  if (/model.*(?:not found|unavailable|does not exist)|\b404\b/.test(message)) return "model";
  if (/overloaded|unavailable|capacity|\b5\d\d\b/.test(message)) return "capacity";
  return "other";
}

/**
 * Calls an OpenAI-compatible chat endpoint, walking the model list on any
 * recoverable failure. A configuration failure aborts immediately because every
 * remaining model would fail the same way (and each failed attempt still counts
 * against the provider's quota).
 */
async function requestChatCompletion(
  prompt: string,
  models: string[],
  config: ChatProviderConfig,
): Promise<{ text: string; model: string }> {
  // Disable SDK retries: we explicitly move to the next model instead, and a
  // failed request still spends provider quota.
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    defaultHeaders: config.headers,
  });
  const failures: string[] = [];
  for (const model of models) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: config.maxTokens(model),
      });
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) throw new Error("response did not contain text");
      return { text, model: response.model || model };
    } catch (error) {
      const failure = asError(error);
      const kind = classifyChatFailure(failure);
      failures.push(`${model}: ${failure.message}`);
      if (kind === "configuration") {
        throw new Error(`${config.label} configuration failed for ${model}: ${failure.message}`);
      }
      console.warn(
        `[Generation] ${config.label} model ${model} failed (${kind}); trying the next model.`,
      );
    }
  }
  throw new Error(`All configured ${config.label} models failed: ${failures.join("; ")}`);
}

async function requestOpenRouter(
  prompt: string,
  models: string[],
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }
  return requestChatCompletion(prompt, models, {
    label: "OpenRouter",
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    maxTokens: () => 1024,
  });
}

async function requestOpencode(
  prompt: string,
  models: string[],
): Promise<{ text: string; model: string }> {
  const apiKey = getOpencodeApiKey();
  if (!apiKey) {
    throw new Error("OPENCODE_GO_API_KEY is not configured.");
  }
  return requestChatCompletion(prompt, models, {
    label: "OpenCode Go",
    apiKey,
    baseURL: process.env.OPENCODE_GO_BASE_URL?.trim() || OPENCODE_BASE_URL,
    // Reasoning-capable models can spend a few thousand tokens before the
    // answer, so each model gets its own budget instead of one shared cap.
    maxTokens: getOpencodeMaxTokens,
    headers: {
      "User-Agent": OPENCODE_USER_AGENT,
      "x-opencode-session": OPENCODE_SESSION_ID,
    },
  });
}

async function generateWithFallback<T>(
  prompt: string,
  parseGemini: (raw: unknown) => T,
  parseText: (text: string) => T,
): Promise<GenerationResult<T>> {
  const failures: ProviderFailure[] = [];

  // OpenCode Go leads: it is the paid primary when configured. Gemini and the
  // OpenRouter free models keep their existing order behind it.
  if (getOpencodeApiKey()) {
    try {
      const { text, model } = await requestOpencode(prompt, getOpencodeModels());
      return {
        value: parseText(text),
        provider: "opencode",
        model,
      };
    } catch (error) {
      const failure = asError(error);
      failures.push({ provider: "opencode", error: failure });
    }
  }

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
      openRouterConfigurationFailed = classifyChatFailure(failure) === "configuration";
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
    /(?:api key|not configured|permission|free tier|\b403\b|rate limit|\b429\b|\b503\b|unavailable|capacity|allowance)/i.test(error.message),
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
