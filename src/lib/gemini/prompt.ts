import type {
  DraftDoc,
  ExemplaryPost,
  ExternalPostDoc,
  PatternAnalysis,
  PostDoc,
  ProductDoc,
  Tip,
  Platform,
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
  minPostLength: number | null | undefined = null,
  maxPostLength: number | null | undefined = null,
  externalPosts: ExternalPostDoc[] = [],
  patternAnalysis?: PatternAnalysis | null,
  explorationRate = 0.15,
  promoProduct: ProductDoc | null = null,
  platform: Platform = "x",
  draftCount = 1,
  promoDraftIndex: number | null = promoProduct ? 0 : null,
) {
  // null/0 = no account-level limit. Promo drafts still need room for the link.
  const floor =
    typeof minPostLength === "number" && minPostLength > 0 ? minPostLength : 0;
  const effectiveMin = promoProduct ? Math.max(floor, 90) : floor;
  const ceiling =
    typeof maxPostLength === "number" && maxPostLength > 0 ? maxPostLength : 240;
  const maxPostLengthResolved = Math.max(ceiling, effectiveMin);
  const targetLengths = Array.from({ length: Math.max(1, draftCount) }, () =>
    Math.floor(Math.random() * (maxPostLengthResolved - effectiveMin + 1)) +
    effectiveMin,
  );
  const targetLength = targetLengths[0];
  const targetLengthSection = draftCount > 1
    ? targetLengths.map((length, index) => `Draft ${index + 1}: ${length} characters`).join("\n")
    : `Target: ${targetLength} characters (Absolute Max: ${maxPostLengthResolved})`;

  const compact = (value: string, max = 180) =>
    value.replace(/\s+/g, " ").trim().slice(0, max);
  // Style samples carry rhythm through line breaks: collapse horizontal
  // whitespace but keep paragraph breaks so the model can imitate them.
  const compactMultiline = (value: string, max = 400) =>
    value
      .replace(/[ \t　]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, max);
  const performanceSignal = (post: PostDoc) => {
    const metrics = post.metrics;
    const structure = post.pattern?.structure ?? "未分類";
    const reactionReason = post.pattern?.reaction_reason ?? "不明";
    const windowLabel = post.performance_window ?? "観測";
    return `- 構成:${compact(structure, 80)} / 反応理由:${compact(reactionReason, 100)} (${windowLabel}表示数:${metrics.impressions ?? "不明"}, いいね:${metrics.likes}, リポスト:${metrics.reposts_or_rethreads}, 返信:${metrics.replies})`;
  };

  // --- Part 2: Input Values (Source Material) ---
  // The character sheet is a specification, not an example. Keep it in its
  // own high-priority block so that the model does not reconstruct the persona
  // from old posts when the sheet has been edited.
  const characterSheetSection = concept
    ? `
[CHARACTER SHEET — HIGHEST PRIORITY]
${concept}

Treat the character sheet above as the current and authoritative definition of
the account. It may intentionally differ from all past posts and examples.
Do not infer, preserve, or restore old personality traits, opinions, speaking
habits, values, or topics from the examples when they conflict with this sheet.
If any source material conflicts with the character sheet, follow the
character sheet and use the source only for an abstract writing technique.
`
    : `
[CHARACTER SHEET — HIGHEST PRIORITY]
(No character sheet is configured.)
`;

  const performanceSection = topPosts.length > 0
    ? `\n[Past Performance Signals — technique only]\n${topPosts.map(performanceSignal).join("\n")}\nUse only these abstract structure/reaction signals. The original post text is intentionally omitted so its old topic and wording cannot leak into the new post.\n`
    : "";
  const styleSection = exemplaryPosts.length > 0
    ? `\n[Account Style Samples — imitate line breaks and rhythm, not just words]\n${exemplaryPosts
        .map((post) => `- ${compactMultiline(post.text)} (意図: ${compact(post.explanation, 120)})`)
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
    ? `\n[External Search Candidates — relevance is NOT verified]\n${externalPosts
        .slice(0, 12)
        .map((post) => {
          const pattern = post.pattern
            ? ` 型:${compact(post.pattern.hook, 80)} / ${compact(post.pattern.structure, 100)}`
            : "";
          const source = `検索語:${compact(post.search_keyword ?? "reference account", 80)} / 検索枠:${post.discovery_mode ?? "timeline"}`;
          return `- ${compact(post.text)} (${source}, 反応率:${post.engagement_rate === null || post.engagement_rate === undefined ? "不明" : post.engagement_rate.toFixed(4)})${pattern}`;
        })
        .join("\n")}\nRelevance rule: reject unrelated examples even when visible metrics are high. Search terms and engagement are not proof of audience fit.\n`
    : "";

  const topicTagInstruction = platform === "threads"
    ? "For Threads, choose at most ONE topicTag without a leading #. It must directly name this post's subject, not a broad trend or unrelated popular topic. Use 1–50 characters; do not include periods (.) or ampersands (&). Omit topicTag when no clear fit exists."
    : "This is an X post. Do not return topicTag.";

    // Legacy pattern stats were calculated from lifetime totals and may contain
  // synthetic engagement-rate fallbacks. Only consume explicitly measured
  // age-normalized cohorts in the generator.
  const measuredPatternAnalysis =
    patternAnalysis?.measurementWindow === "24h" ||
    patternAnalysis?.measurementWindow === "72h"
      ? patternAnalysis
      : null;

  const patternSection = measuredPatternAnalysis && measuredPatternAnalysis.patterns.length > 0
    ? (() => {
        const windowLabel = measuredPatternAnalysis.measurementWindow;
        const metricLabel = measuredPatternAnalysis.exposureMetric ?? "表示数";
        const medianExposure = measuredPatternAnalysis.accountMedianImpressions ?? 0;
        const medianRate = measuredPatternAnalysis.accountMedianEngagementRate;
        const fmt = (value: number) => `${(value * 100).toFixed(2)}%`;
        const reliable = measuredPatternAnalysis.patterns
          .filter((stat) => stat.count >= 3 && typeof stat.medianImpressions === "number" && Number.isFinite(stat.medianImpressions))
          .sort((a, b) => (b.medianImpressions ?? -1) - (a.medianImpressions ?? -1));
        const top = reliable.slice(0, 3);
        const worst = [...reliable].sort(
          (a, b) => (a.medianImpressions ?? -1) - (b.medianImpressions ?? -1),
        ).slice(0, 2);
        const lines = [
          `\n[This Account's Age-Normalized Pattern Performance]`,
          `Measurement window: ${windowLabel}`,
          `Account median ${metricLabel}: ${Math.round(medianExposure)}`,
          `Median post-exposure engagement rate: ${medianRate === null ? "unknown" : fmt(medianRate)}`,
        ];
        if (top.length > 0) {
          lines.push(
            `Highest-reach patterns (prefer when relevant):\n${top
              .map(
                (stat) =>
                  `- ${stat.structure}: ${stat.count} posts, median ${metricLabel} ${Math.round(stat.medianImpressions ?? 0)}, median engagement ${fmt(stat.medianEngagementRate)}`,
              )
              .join("\n")}`,
          );
        }
        if (worst.length > 0) {
          lines.push(
            `Lowest-reach patterns (do not over-repeat):\n${worst
              .map(
                (stat) =>
                  `- ${stat.structure}: ${stat.count} posts, median ${metricLabel} ${Math.round(stat.medianImpressions ?? 0)}, median engagement ${fmt(stat.medianEngagementRate)}`,
              )
              .join("\n")}`,
          );
        }
        lines.push(
          "Treat exposure as the primary reach signal and engagement rate as a separate post-exposure signal. Do not infer causality from these correlations.\n",
        );
        return lines.join("\n");
      })()
    : "";

  const contentSection = measuredPatternAnalysis?.content_insights
    ? (() => {
        const insight = measuredPatternAnalysis.content_insights!;
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
    explore && measuredPatternAnalysis && measuredPatternAnalysis.patterns.length > 0
      ? (() => {
          const topKeys = new Set(
            measuredPatternAnalysis!.patterns
              .slice(0, 3)
              .map((stat) => stat.structure),
          );
          const underExplored = measuredPatternAnalysis!.patterns.filter(
            (stat) => !topKeys.has(stat.structure) && stat.count < 5,
          );
          const pool =
            underExplored.length > 0
              ? underExplored
              : measuredPatternAnalysis!.patterns.filter(
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

  const promoSection = promoProduct
    ? (() => {
        const lines = [
          `\n[Promotion Target — ${draftCount > 1 ? `ONLY DRAFT ${(promoDraftIndex ?? 0) + 1}` : "THIS POST"} MUST NATURALLY INTRODUCE THIS PRODUCT]`,
          `Write this post as a product introduction that fits the account's usual topic, voice, and style. It should read like a helpful recommendation, not a banner ad.`,
          `- 商品名: ${promoProduct.title}`,
        ];
        if (promoProduct.price) lines.push(`- 価格: ${promoProduct.price}`);
        if (promoProduct.category) lines.push(`- カテゴリ: ${promoProduct.category}`);
        if (promoProduct.description) {
          lines.push(`- ターゲット層に刺さる理由: ${promoProduct.description}`);
        }
        if (promoProduct.promo_hook) {
          lines.push(`- おすすめの切り口: ${promoProduct.promo_hook}`);
        }
        lines.push(
          `- 掲載するURL: ${promoProduct.url ?? `https://www.amazon.co.jp/dp/${promoProduct.asin}/`}`,
          `Rules:`,
          `- The URL MUST be included in the post body.`,
          `- Lead with value to the reader (a pain/desire the account's audience has), then present the product as the solution.`,
          `- Stay in the account's normal tone and length. Do not write like a sales pitch.`,
          `- Do not fabricate facts about the product; use only the provided info.`,
        );
        return lines.join("\n");
      })()
    : "";

  const inputValuesBlock = `
# 2. INPUT VALUES (SOURCE MATERIAL)
First apply the character sheet. Then use the following material only as
secondary evidence for topic selection, structure, and originality. Examples
are not a definition of the character and must not override the sheet.
${characterSheetSection}${performanceSection}${styleSection}${tipSection}${referenceSection}${externalSection}${patternSection}${contentSection}${explorationSection}${promoSection}`;

  // --- Part 3: Past Posts (Duplication Prevention) ---
  const avoidTexts = [
      ...recentPosts.map(p => p.text),
      ...drafts.map(d => d.text),
      ...extraAvoid
  ].filter(Boolean);

  // Deduplicate and limit
  const uniqueAvoid = Array.from(new Set(avoidTexts)).slice(0, 20);

  const avoidanceBlock = uniqueAvoid.length > 0
      ? `\n# 3. PAST POSTS (DUPLICATION PREVENTION)\nAVOID repeating the content or phrasing of these posts:\n${uniqueAvoid.map(t => `- ${t.replace(/\s+/g, " ").slice(0, 100)}`).join("\n")}\n`
      : `\n# 3. PAST POSTS (DUPLICATION PREVENTION)\n(No recent posts to avoid)\n`;

  const taskIntro = draftCount > 1
    ? `Generate exactly ${draftCount} independent new posts in the numbered order below. Each must use a different subject/angle, a different opening line, and a different structure where practical. Do not split one idea into several posts.`
    : "Generate ONE new post that:";

  const taskRules = [
    "Matches its own target length in #1.",
    "Obeys the CHARACTER SHEET above as the source of truth for persona, voice, values, opinions, and boundaries.",
    "Is NOT similar to any post in #3 or to any other item in this batch.",
    "Language: Japanese.",
    "Prefer patterns visible in the strongest-performing posts, especially their opening hook and reason to react.",
    "Add a concrete angle or observation rather than a generic summary.",
    "Use external posts only to learn patterns. Never copy their wording, claims, or distinctive phrasing.",
    "Past posts and examples are legacy material. They may inform the writing technique, but must not pull the post back toward the old character when the character sheet has changed.",
    "Evaluate each external candidate against the actual character sheet and intended reader. Search keywords are not proof of relevance. Discard unrelated posts even when their metrics are strong; never force the account persona to fit a viral example.",
    "Keep reach, likes, replies, reposts and engagement rate as separate signals. Do not interpret likes/followers as engagement rate per impression, and do not claim correlation proves causation.",
    ...(draftCount > 1 ? [
      "Make every item substantively different; no name swaps, paraphrases, repeated hooks, or multiple versions of the same idea.",
      "Keep each explanation to one short sentence so the batch stays compact.",
      ...(promoProduct ? [`Only item ${(promoDraftIndex ?? 0) + 1} may promote the product in [Promotion Target]. All other items must be ordinary non-promotional posts.`] : []),
    ] : []),
    topicTagInstruction,
    ...(promoProduct ? ["Follow the [Promotion Target] section only for the designated item: naturally introduce the product and include its URL, in the account's usual voice."] : []),
    ...(explore && measuredPatternAnalysis
      ? ["Ignore the best-pattern preference for the exploration item and follow [Exploration Mode]: try an under-tested structure with fresh content."]
      : ["Follow the pattern performance guidance in #2: use proven structures where relevant and avoid overusing underperforming ones."]),
  ];

  const itemSchema = `{
    "tweet": "Content...",
    "explanation": "One-sentence rationale..."${platform === "threads" ? `,
    "topicTag": "Optional one-topic label without #"` : ""}
  }`;

  return `
You are a creative social media content generator.

# 1. TARGET CHARACTER COUNT
${targetLengthSection} (Absolute Max: ${maxPostLengthResolved})

${inputValuesBlock}
${avoidanceBlock}

# 4. FINAL CHARACTER CHECK
Before writing, reread the CHARACTER SHEET. The generated post must sound like
the current character sheet even if that means abandoning the voice, opinions,
or recurring subjects in every past post listed above.

# TASK
${taskIntro}
${taskRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}

Output strictly in JSON and in the requested order:
${draftCount > 1
    ? `{
  "drafts": [
    ${Array.from({ length: draftCount }, () => itemSchema).join(",\n    ")}
  ]
}`
    : itemSchema}
`;
}
