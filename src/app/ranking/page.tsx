import { cookies } from "next/headers";
import { RankingFilters } from "@/components/ranking-filters";
import { getAccountsForRequest } from "@/lib/services/server-cache";
import type { RankingFilter, PostDoc } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { RankingClient } from "./client";
import { sortAccountsByAutoPost } from "@/lib/utils";

type RankingPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

type ParsedRankingFilter = RankingFilter & { sort: "top" | "latest" };

const STORAGE_KEY = "selected-account-id";

const DEFAULT_FILTER: ParsedRankingFilter = {
  platform: "all",
  media_type: "all",
  period_days: "all",
  sort: "top",
  accountId: "all",
};

function parseParams(
  searchParams: RankingPageProps["searchParams"],
): ParsedRankingFilter {
  const platformParam =
    typeof searchParams.platform === "string"
      ? searchParams.platform
      : DEFAULT_FILTER.platform;
  const mediaParam =
    typeof searchParams.media === "string"
      ? searchParams.media
      : DEFAULT_FILTER.media_type;
  const periodParam =
    typeof searchParams.period === "string"
      ? searchParams.period
      : DEFAULT_FILTER.period_days;
  const sortParam =
    typeof searchParams.sort === "string"
      ? searchParams.sort
      : DEFAULT_FILTER.sort;
  const accountIdParam =
    typeof searchParams.accountId === "string"
      ? searchParams.accountId
      : undefined;

  const platform = ["all", "x", "threads"].includes(platformParam)
    ? (platformParam as RankingFilter["platform"])
    : DEFAULT_FILTER.platform;
  const mediaType = ["all", "text", "image", "video"].includes(mediaParam)
    ? (mediaParam as RankingFilter["media_type"])
    : DEFAULT_FILTER.media_type;
  const periodDays = ["all", 7, 30, 90].includes(
    periodParam === "all" ? "all" : Number(periodParam),
  )
    ? periodParam === "all"
      ? "all"
      : (Number(periodParam) as 7 | 30 | 90)
    : DEFAULT_FILTER.period_days;
  const sort = sortParam === "latest" ? "latest" : "top";

  return {
    platform,
    media_type: mediaType,
    period_days: periodDays,
    sort,
    accountId: accountIdParam,
  };
}

export default async function RankingPage({ searchParams }: RankingPageProps) {
  const cookieStore = cookies();
  const storedAccountId = cookieStore.get(STORAGE_KEY)?.value;

  const initialFilter = parseParams(searchParams);
  const filter: ParsedRankingFilter = {
    ...initialFilter,
    accountId: initialFilter.accountId ?? storedAccountId ?? "all",
  };

  const accounts = sortAccountsByAutoPost(await getAccountsForRequest());

  // Posts are fetched client-side by RankingClient so the list can react to
  // the account switcher without a full navigation.
  const posts: PostDoc[] = [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="ランキング"
        description="プラットフォーム・メディア種別・期間で絞り込み、伸びた投稿を確認できます。"
      />

      <RankingFilters
        platform={filter.platform}
        media={filter.media_type}
        period={String(filter.period_days)}
        sort={filter.sort}
        accountId={filter.accountId ?? "all"}
        accounts={accounts}
      />

      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        スコア = 表示数 × 0.1 ＋ いいね × 40 ＋ リポスト × 80 ＋ 返信 × 70 ＋
        リンククリック × 60
      </p>

      <RankingClient initialPosts={posts} filters={filter} />
    </div>
  );
}
