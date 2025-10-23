import { NextResponse } from "next/server";
import { getTopPosts } from "@/lib/services/firestore.server";
import type { RankingFilter } from "@/lib/types";

function parseParams(searchParams: URLSearchParams): { filter: RankingFilter, sort: 'top' | 'latest', page: number } {
  const platform = (searchParams.get('platform') || 'all') as RankingFilter['platform'];
  const media_type = (searchParams.get('media') || 'all') as RankingFilter['media_type'];
  const period_days = (searchParams.get('period') === 'all' ? 'all' : Number(searchParams.get('period')) || 'all') as RankingFilter['period_days'];
  const accountId = searchParams.get('accountId') || undefined;
  const sort = (searchParams.get('sort') === 'latest' ? 'latest' : 'top');
  const page = Number(searchParams.get('page')) || 1;

  return {
    filter: { platform, media_type, period_days, accountId },
    sort,
    page,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { filter, sort, page } = parseParams(searchParams);

    const result = await getTopPosts(filter, {
      sort,
      limit: 50,
      page,
    });

    return NextResponse.json({ ok: true, posts: result.posts, hasNext: result.hasNext });

  } catch (error) {
    console.error("[API/ranking-data] Failed to load posts", error);
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
