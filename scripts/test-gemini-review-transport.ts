import assert from "node:assert/strict";
import { requestGemini, isGeminiTransportFailure } from "@/lib/gemini/client";

async function main() {
  process.env.GEMINI_API_KEY = "offline-test-key";
  for (let i = 1; i <= 10; i++) delete process.env[`GEMINI_API_KEY_${i}`];
  process.env.GEMINI_RETRY_BASE_MS = "0";
  const originalFetch = globalThis.fetch;
  const networkError = () => Object.assign(new TypeError("fetch failed"), {
    cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
  });
  let calls = 0;
  try {
    globalThis.fetch = async (_input, init) => {
      assert.ok(init?.signal, "blind review must have a deadline");
      if (++calls === 1) throw networkError();
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "review" }] } }] }));
    };
    const reviewed = await requestGemini("offline test", "models/test-reviewer", { timeoutMs: 90_000, transportRetries: 1 });
    assert.equal(calls, 2);
    assert.ok((reviewed as { candidates?: unknown[] }).candidates?.length);

    calls = 0;
    globalThis.fetch = async () => { calls++; throw networkError(); };
    await assert.rejects(
      requestGemini("offline test", "models/test-reviewer", { timeoutMs: 90_000, transportRetries: 1 }),
      (e: unknown) => isGeminiTransportFailure(e) && String(e).includes("UND_ERR_HEADERS_TIMEOUT"),
    );
    assert.equal(calls, 2, "transport retry must be bounded");

    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { code: 400, message: "invalid request" } }), { status: 400 }); };
    await assert.rejects(requestGemini("offline test", "models/test-reviewer", { timeoutMs: 90_000, transportRetries: 1 }), /invalid request/);
    assert.equal(calls, 1, "do not retry permanent request errors");
    assert.equal(isGeminiTransportFailure("review rejected"), false);
    assert.equal(isGeminiTransportFailure("fetch failed"), true);
    console.log("Gemini review transport regression passed.");
  } finally { globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
