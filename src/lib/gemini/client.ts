/**
 * Gemini API Client with automatic API key failover on 429 errors
 */

const MODEL = process.env.GEMINI_MODEL?.trim() || "models/gemini-flash-latest";
const GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 4096,
  responseMimeType: "application/json",
};

type GeminiApiError = {
  error?: {
    message?: string;
    code?: number;
  };
};

export type GeminiUnavailableReason = "quota" | "capacity" | "configuration";

/** A provider-wide failure that should stop further Gemini calls in this run. */
export class GeminiUnavailableError extends Error {
  readonly reason: GeminiUnavailableReason;
  readonly keyCount: number;

  constructor(reason: GeminiUnavailableReason, keyCount: number, message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
    this.reason = reason;
    this.keyCount = keyCount;
  }
}

/**
 * Get all available Gemini API keys from environment variables.
 * Supports both single key (GEMINI_API_KEY) and multiple keys (GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.)
 */
export function getConfiguredGeminiApiKeys(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const keys: string[] = [];

  // The original unnumbered key remains a usable key even when rotation keys
  // are configured. Previously it was silently ignored in that situation.
  const singleKey = env.GEMINI_API_KEY?.trim();
  if (singleKey) keys.push(singleKey);

  for (let i = 1; i <= 10; i++) {
    const key = env[`GEMINI_API_KEY_${i}`]?.trim();
    if (key) {
      keys.push(key);
    }
  }

  return Array.from(new Set(keys));
}

// Track which key was last used for round-robin
let lastUsedKeyIndex = -1;

/**
 * Get the next API key to use (round-robin)
 */
function getNextKeyIndex(keys: string[]): number {
  lastUsedKeyIndex = (lastUsedKeyIndex + 1) % keys.length;
  return lastUsedKeyIndex;
}

function getCapacityRetryDelayMs(retryNumber: number): number {
  const configured = Number(process.env.GEMINI_RETRY_BASE_MS);
  const baseMs = Number.isFinite(configured) && configured >= 0
    ? configured
    : 3000;
  return baseMs * (2 ** Math.max(0, retryNumber - 1));
}

/**
 * Make a request to Gemini API with automatic failover on 429 errors
 */
export async function requestGemini(prompt: string): Promise<unknown> {
  const keys = getConfiguredGeminiApiKeys();

  if (keys.length === 0) {
    throw new GeminiUnavailableError(
      "configuration",
      0,
      "GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY or GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.",
    );
  }

  const startIndex = getNextKeyIndex(keys);
  let lastError: Error | null = null;
  let lastUnavailableReason: GeminiUnavailableReason = "capacity";

  // Try each key, starting from the next one in round-robin order
  for (let i = 0; i < keys.length; i++) {
    const keyIndex = (startIndex + i) % keys.length;
    const apiKey = keys[keyIndex];

    // Capacity failures are often brief. Retry the same request four times in
    // total with exponential backoff; changing API keys does not help a 503.
    const MAX_DEMAND_RETRIES = 3;
    let demandRetries = 0;

    while (demandRetries <= MAX_DEMAND_RETRIES) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: GENERATION_CONFIG,
            }),
          }
        );

        let data: GeminiApiError = {};
        let textContent = "";
        try {
          textContent = await response.text();
          data = JSON.parse(textContent);
        } catch {
          data = { error: { message: textContent || "Non-JSON response received." } };
        }

        if (!response.ok) {
          const errorMessage = data?.error?.message ?? `Gemini API request failed with status ${response.status}`;
          const errorCode = data?.error?.code ?? response.status;
          const isHighDemand = response.status === 503 || errorCode === 503 || errorMessage.includes("high demand") || errorMessage.includes("currently experiencing");
          const isRejectedKey = response.status === 401 ||
            response.status === 403 ||
            /api key.*(?:invalid|not valid|expired)|permission denied/i.test(errorMessage);

          if (isRejectedKey) {
            lastUnavailableReason = "configuration";
            console.warn(`[Gemini] API key ${keyIndex + 1}/${keys.length} was rejected. Switching to next key...`);
            lastError = new Error(errorMessage);
            break;
          }

          if (isHighDemand) {
            lastUnavailableReason = "capacity";
            console.warn(`[Gemini] High demand error (attempt ${demandRetries + 1}/${MAX_DEMAND_RETRIES + 1}). Waiting before retry...`);
            lastError = new Error(errorMessage);
            if (demandRetries < MAX_DEMAND_RETRIES) {
              await new Promise(resolve => setTimeout(
                resolve,
                getCapacityRetryDelayMs(demandRetries + 1),
              ));
              demandRetries++;
              continue;
            } else {
              throw new GeminiUnavailableError(
                "capacity",
                keys.length,
                `Gemini remained unavailable after ${MAX_DEMAND_RETRIES + 1} attempt(s): ${errorMessage}`,
              );
            }
          }

          // If 429 (rate limit), try next key
          if (errorCode === 429 || response.status === 429 || errorMessage.includes("429")) {
            lastUnavailableReason = "quota";
            console.warn(`[Gemini] Rate limit (429) hit on API key ${keyIndex + 1}/${keys.length}. Switching to next key...`);
            lastError = new Error(errorMessage);
            break;
          }

          // Other errors, throw immediately
          throw new Error(errorMessage);
        }

        // Success! Update last used index for round-robin
        lastUsedKeyIndex = keyIndex;
        return data;
      } catch (error) {
        if (error instanceof GeminiUnavailableError) throw error;
        // Network or other errors
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("429")) {
          lastUnavailableReason = "quota";
          console.warn(`[Gemini] Rate limit hit on API key ${keyIndex + 1}/${keys.length}. Switching to next key...`);
          lastError = error instanceof Error ? error : new Error(errorMsg);
          break; // Try next key
        }
        if (errorMsg.includes("high demand") || errorMsg.includes("currently experiencing") || errorMsg.includes("503")) {
          lastUnavailableReason = "capacity";
          console.warn(`[Gemini] High demand error in catch block (attempt ${demandRetries + 1}/${MAX_DEMAND_RETRIES + 1}). Waiting before retry...`);
          lastError = error instanceof Error ? error : new Error(errorMsg);
          if (demandRetries < MAX_DEMAND_RETRIES) {
            await new Promise(resolve => setTimeout(
              resolve,
              getCapacityRetryDelayMs(demandRetries + 1),
            ));
            demandRetries++;
            continue;
          } else {
            throw new GeminiUnavailableError(
              "capacity",
              keys.length,
              `Gemini remained unavailable after ${MAX_DEMAND_RETRIES + 1} attempt(s): ${errorMsg}`,
            );
          }
        }
        throw error;
      }
    }
  }

  // All keys exhausted
  throw new GeminiUnavailableError(
    lastUnavailableReason,
    keys.length,
    `All Gemini API keys are unavailable. Tried ${keys.length} key(s). Last error: ${lastError?.message ?? "Unknown error"}`,
  );
}

/**
 * Make a request to Gemini API with a specific API key (no failover)
 * Use this when you need to use a specific key
 */
export async function requestGeminiWithKey(prompt: string, apiKey: string): Promise<unknown> {
  const MAX_DEMAND_RETRIES = 3;
  let demandRetries = 0;

  while (demandRetries <= MAX_DEMAND_RETRIES) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: GENERATION_CONFIG,
          }),
        }
      );

      let data: GeminiApiError = {};
      let textContent = "";
      try {
        textContent = await response.text();
        data = JSON.parse(textContent);
      } catch {
        data = { error: { message: textContent || "Non-JSON response received." } };
      }

      if (!response.ok) {
        const errorMessage = data?.error?.message ?? `Gemini API request failed with status ${response.status}`;
        const errorCode = data?.error?.code ?? response.status;
        const isHighDemand = response.status === 503 || errorCode === 503 || errorMessage.includes("high demand") || errorMessage.includes("currently experiencing");

        if (isHighDemand && demandRetries < MAX_DEMAND_RETRIES) {
          console.warn(`[Gemini] High demand error in requestGeminiWithKey (attempt ${demandRetries + 1}/${MAX_DEMAND_RETRIES + 1}). Waiting before retry...`);
          await new Promise(resolve => setTimeout(resolve, (demandRetries + 1) * 3000));
          demandRetries++;
          continue;
        }

        throw new Error(errorMessage);
      }

      return data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if ((errorMsg.includes("high demand") || errorMsg.includes("currently experiencing") || errorMsg.includes("503")) && demandRetries < MAX_DEMAND_RETRIES) {
        console.warn(`[Gemini] High demand error in requestGeminiWithKey catch block (attempt ${demandRetries + 1}/${MAX_DEMAND_RETRIES + 1}). Waiting before retry...`);
        await new Promise(resolve => setTimeout(resolve, (demandRetries + 1) * 3000));
        demandRetries++;
        continue;
      }
      throw error;
    }
  }
}
