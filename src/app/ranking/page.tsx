import Link from "next/link";
import { RankingFilters } from "@/components/ranking-filters";
import { getTopPosts } from "@/lib/services/firestore.server";
import { RankingFilter } from "@/lib/types";
import { toTitleCase } from "@/lib/utils";

type RankingPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

type ParsedRankingFilter = RankingFilter & { sort: "top" | "latest" };

const DEFAULT_FILTER: ParsedRankingFilter = {
  platform: "all",
  media_type: "all",
  period_days: 30,
  sort: "top",
};

function parseParams(searchParams: RankingPageProps["searchParams"]): ParsedRankingFilter {
  const platformParam = typeof searchParams.platform === "string" ? searchParams.platform : DEFAULT_FILTER.platform;
  const mediaParam = typeof searchParams.media === "string" ? searchParams.media : DEFAULT_FILTER.media_type;
  const periodParam = typeof searchParams.period === "string" ? Number(searchParams.period) : DEFAULT_FILTER.period_days;
  const sortParam = typeof searchParams.sort === "string" ? searchParams.sort : DEFAULT_FILTER.sort;

  const platform = ["all", "x", "threads"].includes(platformParam)
    ? (platformParam as RankingFilter["platform"])
    : DEFAULT_FILTER.platform;
  const mediaType = ["all", "text", "image", "video"].includes(mediaParam)
    ? (mediaParam as RankingFilter["media_type"])
    : DEFAULT_FILTER.media_type;
  const periodDays = [7, 30, 90].includes(periodParam)
    ? (periodParam as RankingFilter["period_days"])
    : DEFAULT_FILTER.period_days;
  const sort = sortParam === "latest" ? "latest" : "top";

  return {
    platform,
    media_type: mediaType,
    period_days: periodDays,
    sort,
  };
}

export default async function RankingPage({ searchParams }: RankingPageProps) {
  const filter = parseParams(searchParams);
  let posts = [] as Awaited<ReturnType<typeof getTopPosts>>;
  let hasError = false;
  try {
    posts = await getTopPosts(filter, { sort: filter.sort, limit: 200 });
  } catch {
    hasError = true;
  }

  const isLatest = filter.sort === "latest";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Ranking</h1>
        <p className="text-sm text-muted-foreground">
          Filter top performing posts by platform, media type, lookback period, and sort order.
        </p>
      </div>

      <RankingFilters
        platform={filter.platform}
        media={filter.media_type}
        period={String(filter.period_days)}
        sort={filter.sort}
      />

      <p className="text-xs text-muted-foreground">
        Sorting by {isLatest ? "newest posts" : "highest engagement score"}.
      </p>
      <p className="text-xs text-muted-foreground">
        Score = (likes × 2 + reposts × 3 + replies + link clicks × 2) ÷ impressions. Higher is better.
      </p>

      {hasError && (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Failed to load ranking data. Confirm Firebase credentials.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Post</th>
              <th className="px-4 py-3">Platform</th>
              <th className="px-4 py-3">Media</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Score</th>
              <th className="px-4 py-3 text-right">Impressions</th>
              <th className="px-4 py-3 text-right">Likes</th>
              <th className="px-4 py-3 text-right">Reposts</th>
              <th className="px-4 py-3 text-right">Replies</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {posts.map((post) => {
              const scoreTone =
                post.score >= 0.5
                  ? "bg-emerald-100 text-emerald-700"
                  : post.score >= 0.2
                    ? "bg-amber-100 text-amber-700"
                    : "bg-muted text-muted-foreground";
              return (
                <tr key={post.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      <p className="line-clamp-3 text-muted-foreground">
                        {post.text}
                      </p>
                      <Link
                        href={post.url ?? "#"}
                        target="_blank"
                        className="inline-flex items-center text-xs text-primary hover:underline"
                      >
                        Open post
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-surface-active px-3 py-1 text-xs font-semibold text-primary">
                      {toTitleCase(post.platform)}
                    </span>
                  </td>
                  <td className="px-4 py-4 capitalize">{post.media_type}</td>
                  <td className="px-4 py-4 text-sm text-muted-foreground">
                    {new Date(post.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${scoreTone}`}
                    >
                      ⭐ {post.score.toFixed(3)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      📈 {post.metrics.impressions ?? "n/a"}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                      👍 {post.metrics.likes}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                      🔁 {post.metrics.reposts_or_rethreads}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                      💬 {post.metrics.replies}
                    </span>
                  </td>
                </tr>
              );
            })}
            {posts.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  No posts found for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
