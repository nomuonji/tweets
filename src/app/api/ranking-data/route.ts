import { NextResponse } from "next/server";
import { z } from "zod";
import { getTopPosts } from "@/lib/services/firestore.server";
import { RankingFilter } from "@/lib/types";

export const dynamic = 'force-dynamic';

const schema = z.object({
  platform: z.enum(["x", "threads", "all"]).default("all"),
  media_type: z.enum(["text", "image", "video", "all"]).default("all"),
  period_days: z.coerce.number().int().positive().default(7),
  sort: z.enum(["top", "latest"]).default("top"),
  limit: z.coerce.number().int().positive().default(50),
  page: z.coerce.number().int().positive().default(1),
  accountId: z.string().optional(),
});
function parseParams(searchParams: URLSearchParams) {
  const params = Object.fromEntries(searchParams.entries());
  const parsed = schema.parse(params);
  
  return {
    filter: {
      platform: parsed.platform,
      media_type: parsed.media_type,
      period_days: parsed.period_days as RankingFilter['period_days'],
      accountId: parsed.accountId,
    },
    sort: parsed.sort,
    page: parsed.page,
    limit: parsed.limit,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { filter, sort, page, limit } = parseParams(searchParams);

    const result = await getTopPosts(filter, {
      sort,
      limit,
      page,
    });

    return NextResponse.json({ ok: true, posts: result.posts, hasNext: result.hasNext });

  } catch (error) {
    console.error("[API/ranking-data] Failed to load posts", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, message: "Invalid query parameters.", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
