import type { ContentInsight, PostDoc } from "@/lib/types";
import { engagementRate } from "@/lib/pattern";
import { requestGemini } from "@/lib/gemini/client";

type GeminiRaw = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

function extractCandidateText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const candidates = (raw as GeminiRaw).candidates;
  return (candidates?.[0]?.content?.parts ?? [])
    .map((part) => part?.text ?? "")
    .join("")
    .trim();
}

function parseInsight(text: string): ContentInsight | null {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
  try {
    const json = JSON.parse(cleaned);
    if (json && typeof json === "object" && Array.isArray(json.winning_topics)) {
      return {
        winning_topics: json.winning_topics.map(String).slice(0, 8),
        winning_traits: Array.isArray(json.winning_traits)
          ? json.winning_traits.map(String).slice(0, 8)
          : [],
        losing_topics: Array.isArray(json.losing_topics)
          ? json.losing_topics.map(String).slice(0, 6)
          : [],
        suggested_experiment:
          typeof json.suggested_experiment === "string"
            ? json.suggested_experiment.slice(0, 300)
            : "",
        generatedAt: new Date().toISOString(),
      };
    }
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * Asks an LLM to read this account's best and worst posts and extract
 * CONTENT-level learnings (topics, word choice, angle) — beyond the coarse
 * structure-type buckets. Returns null when there are too few posts or the
 * model call fails.
 */
export async function generateContentInsights(
  posts: PostDoc[],
  concept?: string,
): Promise<ContentInsight | null> {
  if (posts.length < 10) return null;

  const sorted = [...posts].sort(
    (a, b) => engagementRate(b.metrics) - engagementRate(a.metrics),
  );
  const top = sorted.slice(0, 8);
  const bottom = sorted.slice(-8).reverse();

  const fmt = (post: PostDoc) => {
    const rate = engagementRate(post.metrics) * 100;
    return `- (反応率 ${rate.toFixed(1)}%) ${post.text
      .replace(/\s+/g, " ")
      .slice(0, 120)}`;
  };

  const conceptLine = concept ? `Account concept: ${concept}\n` : "";
  const prompt = `You analyze a social media account's past posts to find what CONTENT works, beyond structure.

${conceptLine}
TOP-performing posts:
${top.map(fmt).join("\n")}

BOTTOM-performing posts:
${bottom.map(fmt).join("\n")}

Return strict JSON:
{
  "winning_topics": ["...", "..."],
  "winning_traits": ["...", "..."],
  "losing_topics": ["...", "..."],
  "suggested_experiment": "..."
}

- winning_topics: 3-6 concrete subjects/themes that performed well.
- winning_traits: 3-6 content traits: word choice, angle, tone, emotion, specificity.
- losing_topics: 2-4 subjects/themes to avoid.
- suggested_experiment: ONE specific new angle or topic this account has NOT tried, that could beat past winners.

All strings in Japanese.`;

  const raw = await requestGemini(prompt);
  return parseInsight(extractCandidateText(raw));
}

function parseKeywords(text: string): string[] | null {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
  try {
    const json = JSON.parse(cleaned);
    if (
      json &&
      typeof json === "object" &&
      Array.isArray(json.keywords) &&
      json.keywords.length > 0
    ) {
      return json.keywords
        .map(String)
        .map((keyword: string) => keyword.trim())
        .filter(Boolean)
        .slice(0, 6);
    }
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * Suggests search keywords that would surface similar high-performing posts
 * from OTHER accounts, based on this account's concept and top posts.
 * Returns null when there are too few posts or the model call fails.
 */
export async function generateDiscoveryKeywords(
  posts: PostDoc[],
  concept?: string,
): Promise<string[] | null> {
  if (posts.length < 10) return null;

  const sorted = [...posts].sort(
    (a, b) => engagementRate(b.metrics) - engagementRate(a.metrics),
  );
  const top = sorted.slice(0, 10);
  const fmt = (post: PostDoc) => {
    const rate = engagementRate(post.metrics) * 100;
    return `- (反応率 ${rate.toFixed(1)}%) ${post.text
      .replace(/\s+/g, " ")
      .slice(0, 120)}`;
  };

  const conceptLine = concept ? `Account concept: ${concept}\n` : "";
  const prompt = `You are a social media content researcher.
Given this account's concept and its top-performing posts, suggest search keywords to find similar high-performing posts on X (Twitter).

${conceptLine}
Top-performing posts:
${top.map(fmt).join("\n")}

Rules:
- Output 3-5 keywords, in Japanese, short (2-6 words each).
- Keywords should find OTHER accounts' posts in the same topic and direction that this account's audience would engage with.
- Prefer searchable phrases people actually type, not hashtags.

Return strict JSON:
{
  "keywords": ["...", "..."]
}`;

  const raw = await requestGemini(prompt);
  return parseKeywords(extractCandidateText(raw));
}
