import { DateTime } from "luxon";
import type { DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";

function formatPostSummary(posts: PostDoc[]) {
  return posts.map((post, index) => {
    const created = DateTime.fromISO(post.created_at).toFormat("yyyy-LL-dd");
    const impressions = post.metrics.impressions ?? 0;
    return [
      `${index + 1}. ${created} @${post.account_id}`,
      `   Text: ${post.text}`,
      `   Metrics: impressions=${impressions}, likes=${post.metrics.likes}, reposts=${post.metrics.reposts_or_rethreads}, replies=${post.metrics.replies}, score=${post.score.toFixed(3)}`,
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
) {
  const conceptBlock = concept
    ? `\nYour writing MUST strictly adhere to the following concept: ${concept}\n`
    : "";

  const topPostsSummary = topPosts.length
    ? `Here are some of your top-performing posts. Use them as inspiration for style and tone:\n${formatPostSummary(topPosts).join("\n")}`
    : "";

  const referenceSummary = referencePosts.length
    ? `Here are some reference posts for inspiration. Do not copy them, but learn from their style and topics:\n${formatReferencePosts(referencePosts).join("\n")}`
    : "No reference posts provided.";

  const recentSummary = recentPosts.length
    ? `Latest posts (newest first):\n${formatPostSummary(recentPosts).join("\n")}`
    : "Latest posts (newest first):\n- No recent posts available.";

  const tipsBlock = tips.length > 0
    ? `\nGeneral guidance and tips for writing effective posts:\n${tips.map(tip => `- ${tip.text}`).join("\n")}\n`
    : "";

  const exemplaryBlock = exemplaryPosts.length > 0
    ? `\nStudy these exemplary posts for style and tone:\n${exemplaryPosts.map(p => `Post: ${p.text}\nReasoning: ${p.explanation}`).join("\n\n")}\n`
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
      ? `\nAvoid repeating these existing drafts or suggesting something semantically identical:\n${avoidList.join(
          "\n",
        )}\n`
      : "";

  const targetLength = Math.floor(Math.random() * (260 - 80 + 1)) + 80;

  return `
You are a persona analyst and a creative social media strategist for X (Twitter), skilled at emulating a realistic human voice.

Your first task is to analyze the provided past posts to build a detailed persona of the speaker. Understand their tone, interests, and style.

Your second task is to identify recurring themes, topics, and specific keywords that are frequently used in the past posts. Make a mental list of these patterns to actively avoid.

Your third task is to generate a completely new post that the persona would plausibly say next, while **deliberately avoiding the overused themes and keywords you identified**. The goal is to break the pattern and show a new side of the persona. The post should feel fresh and unpredictable, yet still authentic.

To create this human-like realism, you should:
1.  **Embrace Variety:** The new post can be a fresh take on their usual themes, OR it can be something completely different—a random thought, a simple observation, or a reaction to an unseen daily event.
2.  **Simulate Spontaneity:** Occasionally, generate a more casual, "content-less" tweet. Not every post needs to be a masterpiece of insight.
3.  **Think "What's Next?":** Based on the persona, imagine what they are thinking or doing *right now*, and generate a natural, spontaneous post from that mindset.

The goal is a tweet that feels authentic and continues to build a multifaceted, believable character.

Output requirements (strict):
- Respond ONLY with a single JSON object exactly like {"tweet":"...", "explanation":"..."}.
- "tweet": the new post text (target length: around ${targetLength} characters, max 260, no surrounding quotes).
- "explanation": concise reasoning in Japanese (<= 200 characters) explaining how this post fits the persona while avoiding past patterns (e.g., "ペルソナに沿いつつ、頻出する〇〇の話題を避け、新たな一面を見せることで人間味を演出").
- Keep the tone in Japanese if the prior examples are in Japanese. Preserve useful emoji or punctuation patterns.
- Do not add any additional fields, markdown, or commentary.
- Do not copy the reference posts.
- Do not repeat topics from recent posts.

Here is your data:
${conceptBlock}
${tipsBlock}
${exemplaryBlock}
${topPostsSummary}

${referenceSummary}

${recentSummary}
${avoidBlock}
Respond only with JSON.`;
}
