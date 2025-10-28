import { NextResponse } from "next/server";
import { buildPrompt } from "@/lib/gemini/prompt";
import { preparePromptPayload } from "@/lib/services/gemini-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const accountId = String(body.accountId ?? "").trim();
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : 15;

    if (!accountId) {
      return NextResponse.json({ ok: false, message: "accountId is required." }, { status: 400 });
    }

    const { account, topPosts, referencePosts, recentPosts, drafts, tips, exemplaryPosts } = await preparePromptPayload(accountId, limit);

    // Note: In prepare-prompt, we don't have `extraAvoid`, so the prompt might be slightly different
    // from the final one if duplicates are found during actual generation.
    const prompt = buildPrompt(topPosts, referencePosts, recentPosts, drafts, [], tips, exemplaryPosts, account.concept);

    return NextResponse.json({ ok: true, prompt });

  } catch (error) {
    const message = (error as Error).message ?? "";
    if (message.includes("requires an index")) {
        return NextResponse.json(
            { ok: false, message: `Query requires a Firestore index. Please create it in the Firebase console. Details: ${message}` },
            { status: 400 },
        );
    }

    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
