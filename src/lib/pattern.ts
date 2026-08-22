import type { ContentInsight, PostMetrics } from "@/lib/types";

export interface PostPattern {
  hook: string;
  structure: string;
  reaction_reason: string;
}

export interface PatternStat {
  structure: string;
  count: number;
  avgEngagementRate: number;
  medianEngagementRate: number;
  totalImpressions: number;
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
}

export interface PatternAnalysis {
  account_id: string;
  character_version?: number;
  accountMedianEngagementRate: number | null;
  patterns: PatternStat[];
  analyzedPosts: number;
  updatedAt: string;
  /** LLM-extracted content-level learnings (topics, traits, experiments). */
  content_insights?: ContentInsight;
}

export function engagementRate(metrics: PostMetrics): number {
  const interactions =
    metrics.likes +
    metrics.replies * 2 +
    metrics.reposts_or_rethreads * 3;
  if (metrics.impressions && metrics.impressions > 0) {
    return interactions / metrics.impressions;
  }
  return interactions / Math.max(1, Math.log10(interactions + 10));
}

export function extractPattern(text: string): PostPattern {
  const normalized = text.replace(/\s+/g, " ").trim();
  const hook = normalized.slice(0, 60);
  const structure = text.includes("？") || text.includes("?")
    ? "問いかけで始める"
    : /\d+\s*[.)、]/.test(text)
      ? "番号付きの整理"
      : text.includes("しかし") || text.includes("でも") || text.includes("なのに") ||
        text.includes("一方") || text.includes("だけど") || text.includes("けど")
        ? "常識との対比"
        : text.includes("\n")
          ? "短文を改行で積む"
          : /わかる|あるある|だよね|じゃない\?|じゃない？|共感|あるある/.test(text)
            ? "共感を呼びかける"
            : /私が|私も|俺が|俺は|僕が|僕は|自分が|やってみた|してみた|経験|体験した|実際に/.test(text)
              ? "体験を共有する"
              : /大事|大切|コツ|ポイント|注意|危険|やめとけ|学び|気づき|教訓|まとめ/.test(text)
                ? "教訓や注意を伝える"
                : /\d/.test(text)
                  ? "数字で具体化する"
                  : "一つの観察を短く言い切る";
  const reactionReason = text.includes("？") || text.includes("?")
    ? "自分の経験と答えを比べたくなる"
    : text.includes("知ら") || text.includes("意外") || text.includes("実は")
      ? "知らなかった事実への驚き"
      : /わかる|あるある|だよね/.test(text)
        ? "共感してうなずきたくなる"
        : /やってみた|経験|実際に/.test(text)
          ? "体験を疑似体験して比べたくなる"
          : "読者が自分ごと化しやすい具体性";
  return { hook, structure, reaction_reason: reactionReason };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computePatternAnalysis(
  posts: Array<{
    text: string;
    metrics: PostMetrics;
    pattern?: PostPattern;
  }>,
  accountId: string,
): PatternAnalysis {
  const groups = new Map<
    string,
    Array<{
      rate: number;
      impressions: number | null;
      likes: number;
      replies: number;
      reposts: number;
    }>
  >();
  const allRates: number[] = [];

  for (const post of posts) {
    const rate = engagementRate(post.metrics);
    allRates.push(rate);
    const pattern = extractPattern(post.text);
    const key = pattern.structure;
    const group = groups.get(key) ?? [];
    group.push({
      rate,
      impressions: post.metrics.impressions,
      likes: post.metrics.likes,
      replies: post.metrics.replies,
      reposts: post.metrics.reposts_or_rethreads,
    });
    groups.set(key, group);
  }

  const patterns: PatternStat[] = Array.from(groups.entries()).map(
    ([structure, group]) => ({
      structure,
      count: group.length,
      avgEngagementRate:
        group.reduce((sum, item) => sum + item.rate, 0) / group.length,
      medianEngagementRate: median(group.map((item) => item.rate)),
      totalImpressions: group.reduce(
        (sum, item) => sum + (item.impressions ?? 0),
        0,
      ),
      totalLikes: group.reduce((sum, item) => sum + item.likes, 0),
      totalReplies: group.reduce((sum, item) => sum + item.replies, 0),
      totalReposts: group.reduce((sum, item) => sum + item.reposts, 0),
    }),
  );

  return {
    account_id: accountId,
    accountMedianEngagementRate:
      allRates.length > 0 ? median(allRates) : null,
    patterns: patterns.sort(
      (a, b) => b.avgEngagementRate - a.avgEngagementRate,
    ),
    analyzedPosts: posts.length,
    updatedAt: new Date().toISOString(),
  };
}
