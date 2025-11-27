import { DateTime } from "luxon";
import type { DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";

function formatPostSummary(posts: PostDoc[]) {
  return posts.map((post, index) => {
    const created = DateTime.fromISO(post.created_at).toFormat("yyyy-LL-dd");
    return [
      `${index + 1}. [${created}]`,
      `   Text: ${post.text}`,
    ].join("\n");
  });
}

function formatReferencePosts(posts: Tip[]) {
  return posts.map((post, index) => {
    return [
      `${index + 1}. @${post.author_handle} on ${post.platform}`,
      `   Text: ${post.text}`,
    ].join("\n");
  });
}

export function buildPrompt(
  topPosts: PostDoc[],
  referencePosts: Tip[],
  recentPosts: PostDoc[],
  drafts: DraftDoc[],
  extraAvoid: string[],
  tips: Tip[],
  exemplaryPosts: ExemplaryPost[],
  concept?: string,
  minPostLength = 1,
  maxPostLength = 240,
) {
  const targetLength = Math.floor(Math.random() * (maxPostLength - minPostLength + 1)) + minPostLength;

  const conceptBlock = concept
    ? `\n# 1. ACCOUNT CONCEPT (CORE IDENTITY)\nYour writing MUST strictly adhere to the following concept. This is the persona you are enacting:\n"${concept}"\n`
    : "";

  const exemplaryBlock = exemplaryPosts.length > 0
    ? `\n# 2. STYLE REFERENCE (PRIMARY)\nYou MUST strictly emulate the writing style, tone, and voice of these exemplary posts. Replicate the sentence structure, vocabulary, emoji usage, and overall personality:\n${exemplaryPosts.map(p => `Post: ${p.text}\nReasoning: ${p.explanation}`).join("\n\n")}\n`
    : "";

  const topPostsSummary = topPosts.length
    ? `\n# ${exemplaryPosts.length === 0 ? "2. STYLE REFERENCE (SECONDARY)" : "PAST HITS (CONTEXT)"}\nHere are some of your top-performing posts. ${exemplaryPosts.length === 0 ? "Since no exemplary posts are provided, use these as your primary style guide." : "Use these to understand what resonates with your audience."} \nHowever, DO NOT copy their exact topics. We need fresh content.\n${formatPostSummary(topPosts).join("\n")}\n`
    : "";

  const tipsBlock = tips.length > 0
    ? `\n# 3. CONTENT SOURCE (IDEAS)\nUse these tips as a source of ideas and content for your posts. Adapt them to your persona:\n${tips.map(tip => `- ${tip.text}`).join("\n")}\n`
    : "";

  const referenceSummary = referencePosts.length
    ? `\n# REFERENCE POSTS (INSPIRATION)\nHere are some reference posts from others. Do not copy them, but learn from their style and topics:\n${formatReferencePosts(referencePosts).join("\n")}\n`
    : "";

  const recentSummary = recentPosts.length
    ? `\n# RECENT POSTS (AVOID REPETITION)\nLatest posts (newest first). You MUST AVOID repeating the topics and phrasings found here. Do not start sentences with the same words as these posts:\n${formatPostSummary(recentPosts).join("\n")}\n`
    : "";

  const avoidList = Array.from(
    new Set(
      [...drafts.map((draft) => draft.text), ...extraAvoid]
        .filter(Boolean)
        .map((text) => text.trim()),
    ),
  )
    .slice(0, 20)
    .map((text) => `- ${text.replace(/\s+/g, " ").slice(0, 120)}`);

  const avoidBlock =
    avoidList.length > 0
      ? `\n# DRAFTS & REJECTED TEXTS (STRICT AVOIDANCE)\nAvoid repeating these existing drafts or suggesting something semantically identical:\n${avoidList.join(
          "\n",
        )}\n`
      : "";

  return `
You are a highly skilled social media persona analyst and content creator (Grok/Gemini).
Your goal is to generate a new post for a specific account that feels authentic, engaging, and fresh.

${conceptBlock}
${exemplaryBlock}
${topPostsSummary}

${tipsBlock}
${referenceSummary}

${recentSummary}
${avoidBlock}

# 6. TASK
Generate ONE new post that:
1.  **Strictly matches the Account Concept.**
2.  **Mimics the Style Reference** (exemplary posts or top posts).
3.  **Is completely distinct in topic/phrasing from the Recent Posts and Avoidance List.** We want to avoid "more of the same". Do not start with the same words as recent posts.
4.  **Meets the length requirement:** exactly around **${targetLength} characters** (absolute max ${maxPostLength}).
5.  **Is written in Japanese** (unless the concept implies otherwise).
6.  **Has a moderate amount of imperfection.** It does not need to be overly polished; simple and relatable is often better.

# 7. OUTPUT FORMAT (STRICT JSON)
Return ONLY a single JSON object. Do not include markdown code blocks like \`\`\`json.
{
  "tweet": "The post text here...",
  "explanation": "Brief reasoning in Japanese (max 200 chars) on how this fits the concept and avoids past repetition."
}
`;
}
