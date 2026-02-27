
export type GeminiSuggestion = {
  tweet: string;
  explanation: string;
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
              return {
                  tweet: json.tweet,
                  explanation: typeof json.explanation === "string" ? json.explanation : "",
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

    const tweetMatch = cleaned.match(tweetRegex);
    const explanationMatch = cleaned.match(explanationRegex);

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

      return { tweet, explanation };
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
    ) as { tweet?: string; explanation?: string } | undefined;

    if (candidateArgs?.tweet && candidateArgs?.explanation) {
      return {
        tweet: candidateArgs.tweet,
        explanation: candidateArgs.explanation,
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
