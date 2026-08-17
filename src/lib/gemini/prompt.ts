import type {
  DraftDoc,
  ExemplaryPost,
  ExternalPostDoc,
  PatternAnalysis,
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
  patternAnalysis?: PatternAnalysis | null,
  explorationRate = 0.15,
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

  const patternSection = patternAnalysis && patternAnalysis.patterns.length > 0
    ? (() => {
        const median = patternAnalysis.accountMedianEngagementRate ?? 0;
        const fmt = (value: number) => `${(value * 100).toFixed(2)}%`;
        const reliable = patternAnalysis.patterns
          .filter((stat) => stat.count >= 3)
          .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
        const top = reliable.slice(0, 3);
        const worst = reliable
          .filter((stat) => stat.avgEngagementRate < median)
          .slice(-2)
          .reverse();
        const lines = [
          `\n[This Account's Pattern Performance]`,
          `Account median engagement: ${fmt(median)}`,
        ];
        if (top.length > 0) {
          lines.push(
            `Best patterns (prefer these):\n${top
              .map(
                (stat) =>
                  `- ${stat.structure}: ${stat.count} posts, avg ${fmt(stat.avgEngagementRate)}`,
              )
              .join("\n")}`,
          );
        }
        if (worst.length > 0) {
          lines.push(
            `Worst patterns (avoid repeating):\n${worst
              .map(
                (stat) =>
                  `- ${stat.structure}: ${stat.count} posts, avg ${fmt(stat.avgEngagementRate)}`,
              )
              .join("\n")}`,
          );
        }
        lines.push(
          "Choose a structure from the best patterns. Do not reuse a worst pattern unless no better option fits.\n",
        );
        return lines.join("\n");
      })()
    : "";

  const contentSection = patternAnalysis?.content_insights
    ? (() => {
        const insight = patternAnalysis.content_insights!;
        const lines = [`\n[What Content Works For This Account]`];
        if (insight.winning_topics.length > 0) {
          lines.push(
            `Topics that perform well:\n${insight.winning_topics
              .map((topic) => `- ${topic}`)
              .join("\n")}`,
          );
        }
        if (insight.winning_traits.length > 0) {
          lines.push(
            `Content traits that perform well:\n${insight.winning_traits
              .map((trait) => `- ${trait}`)
              .join("\n")}`,
          );
        }
        if (insight.losing_topics.length > 0) {
          lines.push(
            `Topics to avoid:\n${insight.losing_topics
              .map((topic) => `- ${topic}`)
              .join("\n")}`,
          );
        }
        if (insight.suggested_experiment) {
          lines.push(`Untried direction worth testing:\n- ${insight.suggested_experiment}`);
        }
        lines.push("");
        return lines.join("\n");
      })()
    : "";

  const explore = Math.random() < explorationRate;
  const explorationSection =
    explore && patternAnalysis && patternAnalysis.patterns.length > 0
      ? (() => {
          const topKeys = new Set(
            patternAnalysis!.patterns
              .slice(0, 3)
              .map((stat) => stat.structure),
          );
          const underExplored = patternAnalysis!.patterns.filter(
            (stat) => !topKeys.has(stat.structure) && stat.count < 5,
          );
          const pool =
            underExplored.length > 0
              ? underExplored
              : patternAnalysis!.patterns.filter(
                  (stat) => !topKeys.has(stat.structure),
                );
          const target =
            pool.length > 0
              ? pool[Math.floor(Math.random() * pool.length)].structure
              : null;
          const lines = [
            `\n[Exploration Mode — try something new this time]`,
            `The account's proven patterns may be plateauing. For THIS post, run an experiment:`,
            target
              ? `- Target an under-tested structure: 「${target}」`
              : `- Use a structure NOT among the proven best patterns, or invent a new one.`,
            `- Take a fresh topic or angle not recently posted about.`,
            `- Do not repeat the wording or angle of past winners.`,
            `- If it underperforms, that is useful data for the next analysis.`,
            ``,
          ];
          return lines.join("\n");
        })()
      : "";

  const inputValuesBlock = `
# 2. INPUT VALUES (SOURCE MATERIAL)
Use these values as evidence for the new post. Learn the hook, angle, structure, and tone from them; do not copy their wording.
${conceptSection}${performanceSection}${styleSection}${tipSection}${referenceSection}${externalSection}${patternSection}${contentSection}${explorationSection}`;

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
${explore && patternAnalysis
  ? "8. Ignore the best-pattern preference this time and follow the [Exploration Mode] guidance: try the target or an under-tested structure with fresh content."
  : "8. Follow the pattern performance guidance in #2: pick a structure proven to work for this account and avoid the underperforming ones."}

Output strictly in JSON:
{
  "tweet": "Content...",
  "explanation": "Reasoning..."
}
`;
}
