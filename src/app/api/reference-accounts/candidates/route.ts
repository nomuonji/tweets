import { NextResponse } from "next/server";
import { fetchXSearchPosts } from "@/lib/platforms/x";

export async function GET(request: Request) {
  const keyword = new URL(request.url).searchParams.get("keyword")?.trim();
  if (!keyword) {
    return NextResponse.json({ ok: false, message: "keyword is required." }, { status: 400 });
  }

  try {
    const posts = await fetchXSearchPosts(keyword, { limit: 50, searchType: "Top" });
    const candidates = new Map<string, { handle: string; postCount: number; topPost: string; score: number }>();
    for (const post of posts) {
      const rawAuthor = post.raw?.author;
      const handle = rawAuthor && typeof rawAuthor === "object"
        ? (rawAuthor as Record<string, unknown>).screen_name
        : null;
      if (typeof handle !== "string" || !handle.trim()) continue;
      const key = handle.toLowerCase();
      const score = post.metrics.likes + post.metrics.replies * 2 + post.metrics.reposts_or_rethreads * 3;
      const current = candidates.get(key);
      candidates.set(key, {
        handle,
        postCount: (current?.postCount ?? 0) + 1,
        topPost: current && current.score >= score ? current.topPost : post.text,
        score: Math.max(current?.score ?? 0, score),
      });
    }
    return NextResponse.json({
      ok: true,
      keyword,
      candidates: Array.from(candidates.values()).sort((a, b) => b.score - a.score),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}
