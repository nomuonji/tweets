import Link from "next/link";
import { cookies } from "next/headers";
import { RankingFilters } from "@/components/ranking-filters";
import { getAccounts } from "@/lib/services/firestore.server";
import type { RankingFilter, PostDoc } from "@/lib/types";
import { RankingClient } from "./client";

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
    typeof searchParams.sort === "string" ? searchParams.sort : DEFAULT_FILTER.sort;
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
    ? (periodParam === "all" ? "all" : (Number(periodParam) as 7 | 30 | 90))
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

function parsePage(searchParams: RankingPageProps["searchParams"]): number {
  const raw = typeof searchParams.page === "string" ? Number(searchParams.page) : 1;
  if (!Number.isFinite(raw) || raw < 1) {
    return 1;
  }
  return Math.floor(raw);
}

function buildPageLink(filter: ParsedRankingFilter, page: number) {
  const params = new URLSearchParams();
  params.set("platform", filter.platform);
  params.set("media", filter.media_type);
  params.set("period", String(filter.period_days));
  params.set("sort", filter.sort);
  if (filter.accountId && filter.accountId !== "all") {
    params.set("accountId", filter.accountId);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  return `/ranking?${params.toString()}`;
}

export default async function RankingPage({ searchParams }: RankingPageProps) {

  const cookieStore = cookies();

  const storedAccountId = cookieStore.get(STORAGE_KEY)?.value;



  const initialFilter = parseParams(searchParams);



  const accountId = initialFilter.accountId ?? storedAccountId ?? "all";



  const filter: ParsedRankingFilter = {

    ...initialFilter,

    accountId,

  };



  const accounts = await getAccounts();

  const page = parsePage(searchParams);



  // Data fetching is now handled by the client component

  const posts: PostDoc[] = []; 



  const hasNext = false; // Pagination logic might need adjustment or be handled client-side

  const hasPrevious = page > 1;



  return (

    <div className="space-y-8">

      <div>

        <h1 className="text-2xl font-semibold">Ranking</h1>

        <p className="text-sm text-muted-foreground">

          Filter top performing posts by platform, media type, lookback period, and

          sort order.

        </p>

      </div>



      <RankingFilters

        platform={filter.platform}

        media={filter.media_type}

        period={String(filter.period_days)}

        sort={filter.sort}

        accountId={filter.accountId ?? "all"}

        accounts={accounts}

      />



      <p className="text-xs text-muted-foreground">

        Score = (Impressions * 0.1) + (40 * Likes) + (80 * Reposts) + (70 * Replies) + (60 * Clicks)

      </p>



      <RankingClient initialPosts={posts} filters={filter} />



      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">

        <span className="text-xs text-muted-foreground">Page {page}</span>

        <div className="flex gap-2">

          {hasPrevious ? (

            <Link

              href={buildPageLink(filter, page - 1)}

              className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-primary"

            >

              Previous

            </Link>

          ) : (

            <span className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground opacity-60">

              Previous

            </span>

          )}

          {hasNext ? (

            <Link

              href={buildPageLink(filter, page + 1)}

              className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-primary"

            >

              Next

            </Link>

          ) : (

            <span className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground opacity-60">

              Next

            </span>

          )}

        </div>

      </div>

    </div>

  );

}
