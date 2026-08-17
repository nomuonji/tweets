import type {
  DraftDoc,
  ExemplaryPost,
  ExternalPostDoc,
  PostDoc,
  Tip,
} from "@/lib/types";

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
  externalPosts: ExternalPostDoc[] = [],
) {
  const targetLength = Math.floor(Math.random() * (maxPostLength - minPostLength + 1)) + minPostLength;

  const compact = (value: string, max = 180) =>
    value.replace(/\s+/g, " ").trim().slice(0, max);
  const postExample = (post: PostDoc) => {
    const metrics = post.metrics;
    return `- ${compact(post.text)} (表示:${metrics.impressions ?? "不明"}, いいね:${metrics.likes}, リポスト:${metrics.reposts_or_rethreads}, 返信:${metrics.replies})`;
  };

  // --- Part 2: Input Values (Source Material) ---
  const conceptSection = concept ? `\n[Account Concept]\n${concept}\n` : "";

  const performanceSection = topPosts.length > 0
    ? `\n[Past Posts With Strongest Results]\n${topPosts.map(postExample).join("\n")}\n`
    : "";
  const styleSection = exemplaryPosts.length > 0
    ? `\n[Account Style Samples]\n${exemplaryPosts
        .map((post) => `- ${compact(post.text)} (意図: ${compact(post.explanation, 120)})`)
        .join("\n")}\n`
    : "";
  const tipSection = tips.length > 0
    ? `\n[Writing Tips]\n${tips
        .map((tip) => `- ${compact(tip.title, 80)}: ${compact(tip.text, 160)}`)
        .join("\n")}\n`
    : "";
  const referenceSection = referencePosts.length > 0
    ? `\n[Reference Ideas]\n${referencePosts
        .map((reference) => `- ${compact(reference.title, 80)}: ${compact(reference.text, 160)}`)
        .join("\n")}\n`
    : "";
  const externalSection = externalPosts.length > 0
    ? `\n[External Posts Winning In The Target Topic]\n${externalPosts
        .slice(0, 12)
        .map((post) => {
          const pattern = post.pattern
            ? ` 型:${compact(post.pattern.hook, 80)} / ${compact(post.pattern.structure, 100)}`
            : "";
          return `- ${compact(post.text)} (作者:@${post.author_handle}, 反応率:${(post.engagement_rate ?? 0).toFixed(4)})${pattern}`;
        })
        .join("\n")}\n`
    : "";

  const inputValuesBlock = `
# 2. INPUT VALUES (SOURCE MATERIAL)
Use these values as evidence for the new post. Learn the hook, angle, structure, and tone from them; do not copy their wording.
${conceptSection}${performanceSection}${styleSection}${tipSection}${referenceSection}${externalSection}`;

  // --- Part 3: Past Posts (Duplication Prevention) ---
  const avoidTexts = [
      ...recentPosts.map(p => p.text),
      ...drafts.map(d => d.text),
      ...extraAvoid
  ].filter(Boolean);

  // Deduplicate and limit
  const uniqueAvoid = Array.from(new Set(avoidTexts)).slice(0, 30);

  const avoidanceBlock = uniqueAvoid.length > 0
      ? `\n# 3. PAST POSTS (DUPLICATION PREVENTION)\nAVOID repeating the content or phrasing of these posts:\n${uniqueAvoid.map(t => `- ${t.replace(/\s+/g, " ").slice(0, 100)}`).join("\n")}\n`
      : `\n# 3. PAST POSTS (DUPLICATION PREVENTION)\n(No recent posts to avoid)\n`;

  return `
You are a creative social media content generator.

# 1. TARGET CHARACTER COUNT
Target: ${targetLength} characters (Absolute Max: ${maxPostLength})

${inputValuesBlock}
${avoidanceBlock}

# TASK
Generate ONE new post that:
1. Matches the length in #1.
2. Uses the persona/style/ideas from #2.
3. Is NOT similar to any post in #3.
4. Language: Japanese.
5. Prefer patterns visible in the strongest-performing posts, especially their opening hook and reason to react.
6. Add a concrete angle or observation rather than a generic summary.
7. Use external posts only to learn patterns. Never copy their wording, claims, or distinctive phrasing.

Output strictly in JSON:
{
  "tweet": "Content...",
  "explanation": "Reasoning..."
}
`;
}
