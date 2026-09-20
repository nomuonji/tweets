import assert from "node:assert/strict";
import { generateSuggestion } from "@/lib/ai/generation-client";

const originalFetch = globalThis.fetch;
const originalEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_API_KEY_1: process.env.GEMINI_API_KEY_1,
  GEMINI_API_KEY_2: process.env.GEMINI_API_KEY_2,
  GEMINI_API_KEY_3: process.env.GEMINI_API_KEY_3,
  GEMINI_MODELS: process.env.GEMINI_MODELS,
  GEMINI_RETRY_BASE_MS: process.env.GEMINI_RETRY_BASE_MS,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_FREE_MODELS: process.env.OPENROUTER_FREE_MODELS,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function main() {
  try {
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.GEMINI_API_KEY_1;
    delete process.env.GEMINI_API_KEY_2;
    delete process.env.GEMINI_API_KEY_3;
    process.env.GEMINI_MODELS =
      "gemini-3.8-flash,gemini-3.7-flash,gemini-3.1-flash-lite";
    process.env.GEMINI_RETRY_BASE_MS = "0";
    process.env.OPENROUTER_API_KEY = "openrouter-test";
    process.env.OPENROUTER_FREE_MODELS =
      "qwen/qwen3.8-27b:free,google/gemma-4-26b-a4b-it:free";

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
          return jsonResponse({
            candidates: [{ content: { parts: [{ text: "{" }] } }],
          });
        }
        return jsonResponse({ error: { code: 429, message: "quota exhausted" } }, 429);
      }
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        openRouterCalls += 1;
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as { model?: string }
          : input instanceof Request
            ? await input.clone().json() as { model?: string }
            : {};
        if (body.model === "qwen/qwen3.8-27b:free") {
          return jsonResponse({ error: { code: 429, message: "upstream rate limited" } }, 429);
        }
        return jsonResponse({
          id: "chatcmpl_test",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "google/gemma-4-26b-a4b-it:free",
          choices: [{
            index: 0,
            finish_reason: "stop",
            logprobs: null,
            message: {
              role: "assistant",
              content: '{"tweet":"fallback worked","explanation":"test"}',
            },
          }],
        });
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
    console.log("Generation fallback test passed.");
  } finally {
    globalThis.fetch = originalFetch;
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
