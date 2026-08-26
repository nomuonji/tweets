import assert from "node:assert/strict";
import {
  GeminiUnavailableError,
  getConfiguredGeminiApiKeys,
  requestGemini,
} from "@/lib/gemini/client";
import {
  isProviderUnavailableFailure,
  isSuccessfulReply,
  summarizePostAttemptHistory,
} from "@/lib/services/promo-reply-policy";
import type { PromoReplyDoc } from "@/lib/types";
import axios from "axios";
import {
  describeThreadsApiError,
  shouldRetryThreadsContainerCreation,
} from "@/lib/platforms/threads";

function reply(overrides: Partial<PromoReplyDoc>): PromoReplyDoc {
  return {
    id: "reply",
    account_id: "account",
    platform: "threads",
    post_id: "post",
    platform_post_id: "",
    product_id: "product",
    product_asin: "B000000000",
    text: "",
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

async function main() {
  const keys = getConfiguredGeminiApiKeys({
    GEMINI_API_KEY: "base",
    GEMINI_API_KEY_1: "one",
    GEMINI_API_KEY_2: "two",
    GEMINI_API_KEY_3: "three",
  });
  assert.deepEqual(keys, ["base", "one", "two", "three"]);

  const deduplicated = getConfiguredGeminiApiKeys({
    GEMINI_API_KEY: "same",
    GEMINI_API_KEY_1: "same",
  });
  assert.deepEqual(deduplicated, ["same"]);

  const providerFailure = reply({
    status: "failed",
    failure_kind: "provider_unavailable",
    error: "Gemini remained unavailable after 4 attempts",
    retry_after_at: "2026-08-23T03:00:00.000Z",
  });
  const legacyProviderFailure = reply({
    status: "failed",
    error: "All Gemini API keys have hit rate limits or high demand.",
  });
  const generationFailure = reply({
    status: "failed",
    failure_kind: "generation",
    error: "Generated reply did not contain a URL",
    retry_after_at: "2026-08-23T03:00:00.000Z",
  });
  const legacySuccess = reply({ platform_post_id: "platform-reply-id" });
  const explicitSuccess = reply({ status: "posted", platform_post_id: "new-id" });

  assert.equal(isSuccessfulReply(providerFailure), false);
  assert.equal(isSuccessfulReply(legacySuccess), true);
  assert.equal(isSuccessfulReply(explicitSuccess), true);
  assert.equal(isProviderUnavailableFailure(providerFailure), true);
  assert.equal(isProviderUnavailableFailure(legacyProviderFailure), true);
  assert.equal(isProviderUnavailableFailure(generationFailure), false);

  const providerState = summarizePostAttemptHistory([
    providerFailure,
    legacyProviderFailure,
  ]);
  assert.equal(providerState.alreadyPosted, false);
  assert.equal(providerState.failureCount, 0);
  assert.equal(providerState.retryAfter, null);

  const failedState = summarizePostAttemptHistory([generationFailure]);
  assert.equal(failedState.failureCount, 1);
  assert.equal(
    failedState.retryAfter?.toUTC().toISO(),
    "2026-08-23T03:00:00.000Z",
  );

  const postedState = summarizePostAttemptHistory([providerFailure, legacySuccess]);
  assert.equal(postedState.alreadyPosted, true);
  assert.equal(postedState.failureCount, 0);

  const previousFetch = globalThis.fetch;
  const names = [
    "GEMINI_API_KEY",
    ...Array.from({ length: 10 }, (_, index) => `GEMINI_API_KEY_${index + 1}`),
  ];
  const previousKeys = names.map((name) => process.env[name]);
  const previousRetryBase = process.env.GEMINI_RETRY_BASE_MS;
  let fetchCalls = 0;
  try {
    process.env.GEMINI_API_KEY = "base";
    process.env.GEMINI_API_KEY_1 = "one";
    process.env.GEMINI_API_KEY_2 = "two";
    process.env.GEMINI_API_KEY_3 = "three";
    process.env.GEMINI_RETRY_BASE_MS = "0";
    names.slice(4).forEach((name) => delete process.env[name]);
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        error: { code: 429, message: "quota exceeded" },
      }), { status: 429, headers: { "content-type": "application/json" } });
    };

    await assert.rejects(
      requestGemini("test"),
      (error: unknown) =>
        error instanceof GeminiUnavailableError &&
        error.reason === "quota" &&
        error.keyCount === 4,
    );
    assert.equal(fetchCalls, 4);

    const transientThreadsError = new axios.AxiosError(
      "bad request",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: { headers: {} } as never,
        data: { error: { code: 1, message: "Temporary Threads failure" } },
      },
    );
    assert.equal(shouldRetryThreadsContainerCreation(transientThreadsError), true);
    assert.match(
      describeThreadsApiError("Threads test", transientThreadsError).message,
      /HTTP 400.*Temporary Threads failure/,
    );

    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls < 3) {
        return new Response(JSON.stringify({
          error: { code: 503, message: "model is experiencing high demand" },
        }), { status: 503, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    assert.deepEqual(await requestGemini("test"), {
      candidates: [{ content: { parts: [] } }],
    });
    assert.equal(fetchCalls, 3);

    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        error: { code: 503, message: "model is experiencing high demand" },
      }), { status: 503, headers: { "content-type": "application/json" } });
    };
    await assert.rejects(
      requestGemini("test"),
      (error: unknown) =>
        error instanceof GeminiUnavailableError &&
        error.reason === "capacity" &&
        error.keyCount === 4,
    );
    assert.equal(fetchCalls, 4);

    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({
          error: { code: 403, message: "API key not valid" },
        }), { status: 403, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    assert.deepEqual(await requestGemini("test"), { candidates: [] });
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      const value = previousKeys[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
    if (previousRetryBase === undefined) delete process.env.GEMINI_RETRY_BASE_MS;
    else process.env.GEMINI_RETRY_BASE_MS = previousRetryBase;
  }

  console.log("Promo reliability tests passed (25 assertions).\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
