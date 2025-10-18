import { NextResponse } from "next/server";
import { syncPostsForAllAccounts } from "@/lib/services/sync-service";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await syncPostsForAllAccounts({
      lookbackDays: body.lookbackDays,
      maxPosts: body.maxPosts,
      accountIds: Array.isArray(body.accountIds)
        ? (body.accountIds as string[]).filter((id) => typeof id === "string")
        : undefined,
      ignoreCursor: body.ignoreCursor === true,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
