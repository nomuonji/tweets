
export type GeminiSuggestion = {
  tweet: string;
  explanation: string;
  topicTag?: string;
};

type GeminiFunctionCall = {
  args?: Record<string, unknown>;
};

type GeminiPart = {
  text?: string;
  functionCall?: GeminiFunctionCall;
};

type GeminiContent = {
  parts?: GeminiPart[];
};

type GeminiCandidate = {
  content?: GeminiContent;
};

export type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

/**
 * Sanitizes the raw text from the model (removes markdown code blocks).
 */
export function sanitizeCandidateText(text: string): string {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
}

/**
 * Robustly parses text which is expected to be JSON.
 */
export function parseSuggestionText(text: string): GeminiSuggestion {
    const cleaned = sanitizeCandidateText(text);

    // A. Try JSON.parse
    try {
      const json = JSON.parse(cleaned);
      if (json && typeof json === "object") {
          if (typeof json.tweet === "string") {
              const topicTag = typeof json.topicTag === "string"
                ? json.topicTag
                : typeof json.topic_tag === "string"
                  ? json.topic_tag
                  : undefined;
              return {
                  tweet: json.tweet,
                  explanation: typeof json.explanation === "string" ? json.explanation : "",
                  ...(topicTag ? { topicTag } : {}),
              };
          }
      }
    } catch {
      // JSON parse failed, proceed to regex
    }

    // B. Try Regex (tolerant of escaped quotes and missing explanation)
    // Matches "tweet": "..." where ... can contain escaped quotes
    const tweetRegex = /"tweet"\s*:\s*"((?:[^"\\]|\\.)*)"/i;
    const explanationRegex = /"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/i;
    const topicTagRegex = /"(?:topicTag|topic_tag)"\s*:\s*"((?:[^"\\]|\\.)*)"/i;

    const tweetMatch = cleaned.match(tweetRegex);
    const explanationMatch = cleaned.match(explanationRegex);
    const topicTagMatch = cleaned.match(topicTagRegex);

    if (tweetMatch) {
      // Helper to unescape JSON string content
      const unescapeJsonString = (str: string) => {
        try {
          // Wrap in quotes and parse to handle all JSON escapes (\uXXXX, \n, etc.)
          // We replace newlines with \n to handle multi-line strings which are invalid in JSON but common in LLM output
          return JSON.parse(`"${str.replace(/\n/g, "\\n")}"`);
        } catch {
          // Fallback: simple replacement
          return str
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            .replace(/\\n/g, "\n");
        }
      };

      const tweet = unescapeJsonString(tweetMatch[1]);
      const explanation = explanationMatch
        ? unescapeJsonString(explanationMatch[1])
        : "";

      const topicTag = topicTagMatch ? unescapeJsonString(topicTagMatch[1]) : undefined;
      return { tweet, explanation, ...(topicTag ? { topicTag } : {}) };
    }

    // C. Fallback logic
    // If it starts with `{`, it's likely a broken JSON that we couldn't parse or regex match.
    // Returning the raw text would be bad (user gets JSON code as tweet).
    if (cleaned.startsWith("{")) {
      throw new Error("Failed to parse JSON response from model.");
    }

    // D. Legacy fallback: split by double newlines
    const sections = cleaned.split(/\n{2,}/);
    return {
      tweet: sections[0] ?? cleaned,
      explanation:
        sections.slice(1).join("\n\n") ||
        "Failed to extract a reasoning explanation from the model response.",
    };
}

/**
 * Parses a multi-draft JSON response. Every returned item must be a usable
 * suggestion; callers may accept a shorter batch and top it up on a later run.
 */
export function parseSuggestionsText(text: string): GeminiSuggestion[] {
  const cleaned = sanitizeCandidateText(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Failed to parse batch JSON response from model.");
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).drafts)
      ? (parsed as { drafts: unknown[] }).drafts
      : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).suggestions)
        ? (parsed as { suggestions: unknown[] }).suggestions
        : null;

  if (!entries || entries.length === 0) {
    throw new Error("Batch response must contain a non-empty drafts array.");
  }

  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Batch item ${index + 1} is not an object.`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.tweet !== "string" || !item.tweet.trim()) {
      throw new Error(`Batch item ${index + 1} has no tweet text.`);
    }
    const topicTag = typeof item.topicTag === "string"
      ? item.topicTag
      : typeof item.topic_tag === "string"
        ? item.topic_tag
        : undefined;
    return {
      tweet: item.tweet.trim(),
      explanation: typeof item.explanation === "string" ? item.explanation : "",
      ...(topicTag ? { topicTag } : {}),
    };
  });
}

/** Extracts a batch from Gemini text output or structured function-call args. */
export function parseGeminiSuggestionsResponse(raw: unknown): GeminiSuggestion[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gemini batch response was empty or invalid.");
  }

  const { candidates } = raw as GeminiResponse;
  const parts = candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part?.text ?? "").join("").trim();
  if (text) return parseSuggestionsText(text);

  const args = parts
    .map((part) => part?.functionCall?.args ?? null)
    .find((value) =>
      value && (
        Array.isArray(value.drafts) ||
        Array.isArray(value.suggestions)
      ),
    );
  if (args) return parseSuggestionsText(JSON.stringify(args));

  throw new Error("Gemini batch response did not include text or a drafts function call.");
}

/**
 * Parses the raw response from Gemini/Grok API into a structured suggestion.
 * Handles JSON, function calls, and fallback text parsing.
 */
export function parseGeminiResponse(raw: unknown): GeminiSuggestion {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gemini response was empty or invalid.");
  }

  const { candidates } = raw as GeminiResponse;
  const candidateParts = candidates?.[0]?.content?.parts ?? [];

  // 1. Try to extract text from parts
  const text = candidateParts
    .map((part) => part?.text ?? "")
    .join("")
    .trim();

  // 2. If no text, check for function calls (structured output)
  if (!text) {
    const functionArgs = candidateParts
      .map((part) => part?.functionCall?.args ?? null)
      .filter((args): args is Record<string, unknown> => Boolean(args));

    const candidateArgs = functionArgs.find(
      (args) =>
        typeof args.tweet === "string" && typeof args.explanation === "string"
    ) as { tweet?: string; explanation?: string; topicTag?: string; topic_tag?: string } | undefined;

    if (candidateArgs?.tweet && candidateArgs?.explanation) {
      return {
        tweet: candidateArgs.tweet,
        explanation: candidateArgs.explanation,
        ...((candidateArgs.topicTag ?? candidateArgs.topic_tag)
          ? { topicTag: candidateArgs.topicTag ?? candidateArgs.topic_tag }
          : {}),
      };
    }

    throw new Error(
      `Gemini response did not include any text or valid function call. Raw snippet: ${JSON.stringify(
        raw
      ).slice(0, 400)}`
    );
  }

  // 3. Clean and parse text
  return parseSuggestionText(text);
}
