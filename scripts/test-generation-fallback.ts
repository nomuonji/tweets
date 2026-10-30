import assert from "node:assert/strict";
import { generateSuggestion } from "@/lib/ai/generation-client";

const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_1",
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEY_3",
  "GEMINI_MODELS",
  "GEMINI_RETRY_BASE_MS",
  "OPENROUTER_API_KEY",
  "OPENROUTER_FREE_MODELS",
  "OPENCODE_GO_API_KEY",
  "OPENCODE_GO_MODELS",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function chatCompletion(content: string, model: string): Response {
  return jsonResponse({
    id: "chatcmpl_test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: { role: "assistant", content },
    }],
  });
}

function geminiResponse(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function requestBody(init?: RequestInit): { model?: string } {
  if (typeof init?.body === "string") {
    return JSON.parse(init.body) as { model?: string };
  }
  return {};
}

function headerValue(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers as HeadersInit | undefined).get(name);
}

function resetEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete process.env.OPENCODE_GO_API_KEY;
  delete process.env.OPENCODE_GO_MODELS;
  process.env.GEMINI_API_KEY = "gemini-test";
  delete process.env.GEMINI_API_KEY_1;
  delete process.env.GEMINI_API_KEY_2;
  delete process.env.GEMINI_API_KEY_3;
  process.env.GEMINI_MODELS = "gemini-3.8-flash,gemini-3.7-flash,gemini-3.1-flash-lite";
  process.env.GEMINI_RETRY_BASE_MS = "0";
  process.env.OPENROUTER_API_KEY = "openrouter-test";
  process.env.OPENROUTER_FREE_MODELS = "qwen/qwen3.8-27b:free,google/gemma-4-26b-a4b-it:free";
}

/** OpenCode Go wins when its key is present, and it is called like a coding client. */
async function opencodePrimaryScenario() {
  process.env.OPENCODE_GO_API_KEY = "opencode-test";
  process.env.OPENCODE_GO_MODELS = "glm-5.3-flash,qwen3.8-flash";

  const calls: Array<{ model?: string; userAgent: string | null; session: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("opencode.ai/inference/go/openai/v1/chat/completions")) {
      const body = requestBody(init);
      calls.push({
        model: body.model,
        userAgent: headerValue(init, "user-agent"),
        session: headerValue(init, "x-opencode-session"),
      });
      return chatCompletion('{"tweet":"opencode primary","explanation":"test"}', body.model ?? "glm-5.3-flash");
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await generateSuggestion("test prompt");
  assert.equal(result.provider, "opencode");
  assert.equal(result.model, "glm-5.3-flash");
  assert.equal(result.value.tweet, "opencode primary");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "glm-5.3-flash");
  assert.equal(calls[0].userAgent, "tweets-autogen/1.0");
  assert.ok(calls[0].session, "OpenCode requests must carry a session id");
}

/** An exhausted OpenCode allowance must fall through to the existing chain. */
async function opencodeQuotaFallsBackScenario() {
  process.env.OPENCODE_GO_API_KEY = "opencode-test";
  process.env.OPENCODE_GO_MODELS = "glm-5.3-flash,qwen3.8-flash";

  let opencodeCalls = 0;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("opencode.ai/inference/go/openai/v1/chat/completions")) {
      opencodeCalls += 1;
      return jsonResponse({ error: { message: "monthly allowance exceeded", code: 429 } }, 429);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return geminiResponse('{"tweet":"gemini after opencode","explanation":"test"}');
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await generateSuggestion("test prompt");
  assert.equal(result.provider, "gemini");
  assert.equal(result.value.tweet, "gemini after opencode");
  assert.equal(opencodeCalls, 2, "every configured OpenCode model should be tried once");
}

/** With no OpenCode key the provider order is unchanged. */
async function openRouterFallbackScenario() {
  let geminiCalls = 0;
  const geminiModels: string[] = [];
  let openRouterCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      const model = url.match(/v1beta\/(models\/[^:]+):generateContent/)?.[1];
      if (model) geminiModels.push(model);
      if (model === "models/gemini-3.8-flash") {
        return geminiResponse("{");
      }
      return jsonResponse({ error: { code: 429, message: "quota exhausted" } }, 429);
    }
    if (url.includes("openrouter.ai/api/v1/chat/completions")) {
      openRouterCalls += 1;
      const body = requestBody(init);
      if (body.model === "qwen/qwen3.8-27b:free") {
        return jsonResponse({ error: { code: 429, message: "upstream rate limited" } }, 429);
      }
      return chatCompletion('{"tweet":"fallback worked","explanation":"test"}', "google/gemma-4-26b-a4b-it:free");
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await generateSuggestion("test prompt");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "google/gemma-4-26b-a4b-it:free");
  assert.equal(result.value.tweet, "fallback worked");
  assert.equal(geminiCalls, 3);
  assert.deepEqual(geminiModels, [
    "models/gemini-3.8-flash",
    "models/gemini-3.7-flash",
    "models/gemini-3.1-flash-lite",
  ]);
  assert.equal(openRouterCalls, 2);
}

async function main() {
  try {
    resetEnv();
    await opencodePrimaryScenario();
    resetEnv();
    await opencodeQuotaFallsBackScenario();
    resetEnv();
    await openRouterFallbackScenario();
    console.log("Generation fallback test passed.");
  } finally {
    globalThis.fetch = originalFetch;
    resetEnv();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
