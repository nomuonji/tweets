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
    });

    // Log debug info on the server and remove it from the response
    if (Array.isArray(result)) {
      result.forEach(item => {
        if (item.debug && Array.isArray(item.debug)) {
          console.log(`[Sync Debug - ${item.handle || item.accountId}]:`);
          item.debug.forEach(log => console.log(`  -> ${log}`));
        }
        delete item.debug;
      });
    }

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
