/**
 * Gemini API Client with automatic API key failover on 429 errors
 */

const MODEL = "models/gemini-flash-latest";
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

/**
 * Get all available Gemini API keys from environment variables.
 * Supports both single key (GEMINI_API_KEY) and multiple keys (GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.)
 */
function getApiKeys(): string[] {
  const keys: string[] = [];

  // First, check for numbered keys (GEMINI_API_KEY_1, GEMINI_API_KEY_2, ...)
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) {
      keys.push(key);
    }
  }

  // If no numbered keys found, fall back to single GEMINI_API_KEY
  if (keys.length === 0) {
    const singleKey = process.env.GEMINI_API_KEY;
    if (singleKey) {
      keys.push(singleKey);
    }
  }

  return keys;
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

/**
 * Make a request to Gemini API with automatic failover on 429 errors
 */
export async function requestGemini(prompt: string): Promise<unknown> {
  const keys = getApiKeys();

  if (keys.length === 0) {
    throw new Error("GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY or GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.");
  }

  const startIndex = getNextKeyIndex(keys);
  let lastError: Error | null = null;

  // Try each key, starting from the next one in round-robin order
  for (let i = 0; i < keys.length; i++) {
    const keyIndex = (startIndex + i) % keys.length;
    const apiKey = keys[keyIndex];

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

      const data = await response.json() as GeminiApiError;

      if (!response.ok) {
        const errorMessage = data?.error?.message ?? `Gemini API request failed with status ${response.status}`;
        const errorCode = data?.error?.code ?? response.status;

        // If 429 (rate limit), try next key
        if (errorCode === 429 || response.status === 429) {
          console.warn(`[Gemini] Rate limit (429) hit on API key ${keyIndex + 1}/${keys.length}. Switching to next key...`);
          lastError = new Error(errorMessage);
          continue;
        }

        // Other errors, throw immediately
        throw new Error(errorMessage);
      }

      // Success! Update last used index for round-robin
      lastUsedKeyIndex = keyIndex;
      return data;
    } catch (error) {
      // Network or other errors
      if (error instanceof Error && error.message.includes("429")) {
        console.warn(`[Gemini] Rate limit hit on API key ${keyIndex + 1}/${keys.length}. Switching to next key...`);
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  // All keys exhausted
  throw new Error(
    `All Gemini API keys have hit rate limits (429). Tried ${keys.length} key(s). Last error: ${lastError?.message ?? "Unknown error"}`
  );
}

/**
 * Make a request to Gemini API with a specific API key (no failover)
 * Use this when you need to use a specific key
 */
export async function requestGeminiWithKey(prompt: string, apiKey: string): Promise<unknown> {
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

  const data = await response.json() as GeminiApiError;

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Gemini API request failed with status ${response.status}`);
  }

  return data;
}
