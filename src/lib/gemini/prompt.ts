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
    ? `Here are some of your top-performing posts. Analyze what aspects of these posts resonated with your audience:\n${formatPostSummary(topPosts).join("\n")}`
    : "";

  const referenceSummary = referencePosts.length
    ? `Here are some reference posts for inspiration. Do not copy them, but learn from their style and topics:\n${formatReferencePosts(referencePosts).join("\n")}`
    : "No reference posts provided.";

  const recentSummary = recentPosts.length
    ? `Latest posts (newest first):\n${formatPostSummary(recentPosts).join("\n")}`
    : "Latest posts (newest first):\n- No recent posts available.";

  const tipsBlock = tips.length > 0
    ? `\nUse these tips as a source of ideas and content for your posts:\n${tips.map(tip => `- ${tip.text}`).join("\n")}\n`
    : "";

  const exemplaryBlock = exemplaryPosts.length > 0
    ? `\nYou MUST strictly emulate the writing style, tone, and voice of these exemplary posts. Replicate the sentence structure, vocabulary, emoji usage, and overall personality conveyed in these examples:\n${exemplaryPosts.map(p => `Post: ${p.text}\nReasoning: ${p.explanation}`).join("\n\n")}\n`
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

  const targetLength = Math.floor(Math.random() * (240 - 1 + 1)) + 1;

  return `
You are a persona analyst and a creative social media strategist for X (Twitter), skilled at emulating a realistic human voice.

Your first task is to analyze the provided past posts to build a detailed persona of the speaker. Understand their tone, interests, and style.

Your second task is to identify recurring themes, topics, and specific keywords that are frequently used in the past posts. Make a mental list of these patterns to actively avoid.

Your third task is to generate a completely new post with a target length of **exactly ${targetLength} characters**. The post should be what the persona would plausibly say next, while **deliberately avoiding the overused themes and keywords you identified**. The goal is to break the pattern and show a new side of the persona. The post should feel fresh and unpredictable, yet still authentic.

To create this human-like realism, you should follow these 20 conditions for human-like writing:
1.  **Include personal experiences and anecdotes:** Share stories and events from your life.
2.  **Naturally incorporate emotional expressions:** Let your feelings show through in your writing.
3.  **Vary sentence length:** Mix short, punchy sentences with longer, more descriptive ones.
4.  **Use colloquialisms and contractions:** Write in a conversational style, like you're talking to a friend.
5.  **Effectively use metaphors and analogies:** Make complex ideas easier to understand with comparisons.
6.  **Speak directly to the reader:** Use "you" and "I" to create a connection with your audience.
7.  **Have an unpredictable development:** Surprise your readers with unexpected twists and turns.
8.  **Have a moderate amount of imperfection:** Don't be afraid to make mistakes; it makes you more human.
9.  **Change tone according to the context:** Adapt your writing style to the topic and your mood.
10. **Rephrase technical terms in everyday language:** Explain complex topics in a way that everyone can understand.
11. **Use conjunctions naturally:** Connect your ideas with words like "and," "but," and "so."
12. **Avoid repeating the same words:** Use a thesaurus to find synonyms and keep your writing fresh.
13. **Explain abstract concepts with concrete examples:** Make abstract ideas easier to understand with real-world examples.
14. **Intersperse questions and exclamations:** Use punctuation to add emphasis and emotion to your writing.
15. **Insert anecdotes and stories:** Share personal stories to make your writing more engaging.
16. **Explain from the reader's perspective:** Put yourself in your reader's shoes and explain things in a way that they can understand.
17. **Sometimes include digressions and asides:** Go off-topic to add personality and humor to your writing.
18. **Overlays emotions onto numbers and facts:** Don't just present data; tell the story behind it.
19. **Reflect cultural background and current events:** Show that you're aware of what's happening in the world.
20. **Has unique phrasing and quirks:** Develop your own unique writing style that sets you apart from everyone else.
The goal is a tweet that feels authentic and continues to build a multifaceted, believable character.

Output requirements (strict):
- Respond ONLY with a single JSON object exactly like {"tweet":"...", "explanation":"..."}.
- "tweet": The new post text. Its length MUST be very close to the target of ${targetLength} characters. The absolute maximum is 240 characters. Do not include surrounding quotes.
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
