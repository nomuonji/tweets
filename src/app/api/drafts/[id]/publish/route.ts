import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { publishXPost } from "@/lib/platforms/x";
import { publishThreadsPost } from "@/lib/platforms/threads";
import type { DraftDoc, PostDoc } from "@/lib/types";
import { getAccounts } from "@/lib/services/firestore.server";

// This function is duplicated from scheduler-service.ts
// Consider refactoring to a shared location if complexity grows.
function buildPostText(draft: DraftDoc) {
  const hashtags = draft.hashtags?.length
    ? ` ${draft.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}`
    : "";
  return `${draft.text}${hashtags}`;
}

// This function is duplicated from scheduler-service.ts
async function publishDraft(draft: DraftDoc) {
  const accounts = await getAccounts();
  const account =
    accounts.find((item) => item.id === draft.target_account_id) ??
    accounts.find((item) => item.platform === draft.target_platform);

  if (!account) {
    throw new Error(`Account not found for draft ${draft.id}`);
  }

  if (draft.target_platform === "x") {
    return publishXPost(account, { text: buildPostText(draft) });
  }
  return publishThreadsPost(account, { text: buildPostText(draft) });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const draftId = params.id;
    if (!draftId) {
      return NextResponse.json(
        { ok: false, message: "Draft ID is required" },
        { status: 400 },
      );
    }

    const draftRef = adminDb.collection("drafts").doc(draftId);
    const draftSnapshot = await draftRef.get();

    if (!draftSnapshot.exists) {
      return NextResponse.json(
        { ok: false, message: "Draft not found" },
        { status: 404 },
      );
    }

    const draft = { id: draftSnapshot.id, ...draftSnapshot.data() } as DraftDoc;

    // --- Start of logic duplicated from scheduler-service.ts ---
    const result = await publishDraft(draft);
    const nowStr = DateTime.utc().toISO();
    const accountId = draft.target_account_id;

    const prefixedId = `${draft.target_platform}_${result.platform_post_id}`;

    const newPost: PostDoc = {
      id: prefixedId,
      account_id: accountId!,
      platform: draft.target_platform,
      platform_post_id: result.platform_post_id,
      text: buildPostText(draft),
      created_at: nowStr,
      media_type: "text",
      has_url: buildPostText(draft).includes("http"),
      metrics: {
        impressions: 0,
        likes: 0,
        replies: 0,
        reposts_or_rethreads: 0,
        quotes: 0,
        link_clicks: 0,
      },
      score: 0,
      raw: result.raw,
      url: result.url,
      fetched_at: nowStr,
    };

    const batch = adminDb.batch();
    const postRef = adminDb.collection("posts").doc(prefixedId);
    
    batch.set(postRef, newPost);
    batch.delete(draftRef);

    await batch.commit();
    // --- End of duplicated logic ---

    return NextResponse.json({ ok: true, publishedPost: newPost });

  } catch (error) {
    console.error("[Publish API] Error:", error);
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
