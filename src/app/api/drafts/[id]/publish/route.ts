import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { publishXPost } from "@/lib/platforms/x";
import { publishThreadsPost } from "@/lib/platforms/threads";
import type { AccountDoc, DraftDoc, PostDoc } from "@/lib/types";
import { getAccounts } from "@/lib/services/firestore.server";
import {
  recordPublishFailure,
} from "@/lib/services/scheduler-service";
import {
  belongsToCharacterVersion,
  getCharacterVersion,
} from "@/lib/character-version";

// This function is duplicated from scheduler-service.ts
// Consider refactoring to a shared location if complexity grows.
function buildPostText(draft: DraftDoc) {
  const hashtags = draft.hashtags?.length
    ? ` ${draft.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}`
    : "";
  return `${draft.text}${hashtags}`;
}

// This function is duplicated from scheduler-service.ts
async function publishDraft(draft: DraftDoc, knownAccount?: AccountDoc) {
  const accounts = knownAccount ? [] : await getAccounts();
  const account =
    knownAccount ??
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

    let draft: DraftDoc;
    try {
      draft = await adminDb.runTransaction(async (transaction) => {
        const doc = await transaction.get(draftRef);
        if (!doc.exists) {
          throw new Error("Draft not found");
        }
        const data = doc.data() as DraftDoc;
        if (data.status === "publishing") {
          throw new Error("Draft is already being published");
        }
        transaction.update(draftRef, { status: "publishing" });
        return { ...data, id: doc.id } as DraftDoc;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "Draft not found") {
        return NextResponse.json(
          { ok: false, message: "Draft not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { ok: false, message: err instanceof Error ? err.message : String(err) },
        { status: 409 },
      );
    }

    // --- Start of logic duplicated from scheduler-service.ts ---
    const accountId = draft.target_account_id;
    const fullText = buildPostText(draft);
    let targetAccount: AccountDoc | undefined;

    if (accountId) {
      const accountSnapshot = await adminDb.collection("accounts").doc(accountId).get();
      if (!accountSnapshot.exists) {
        throw new Error("Account not found.");
      }
      const currentCharacterVersion = getCharacterVersion(
        accountSnapshot.data() ?? {},
      );
      targetAccount = {
        id: accountSnapshot.id,
        ...accountSnapshot.data(),
      } as AccountDoc;
      if (!belongsToCharacterVersion(draft, currentCharacterVersion)) {
        await draftRef.update({
          status: "draft",
          updated_at: DateTime.utc().toISO(),
          last_error: {
            message: "キャラクターシート変更前の下書きです。内容を確認するか再生成してください。",
            occurred_at: DateTime.utc().toISO(),
          },
        });
        return NextResponse.json(
          {
            ok: false,
            message: "キャラクターシート変更前の下書きはそのまま投稿できません。",
          },
          { status: 409 },
        );
      }
      const { hasDuplicatePost } = await import("@/lib/services/scheduler-service");
      const isDuplicate = await hasDuplicatePost(accountId, fullText);
      if (isDuplicate) {
        await draftRef.update({
          status: "failed",
          last_error: {
            message: "直近24時間以内に同じ内容の投稿があります。",
            occurred_at: DateTime.utc().toISO(),
          },
          updated_at: DateTime.utc().toISO(),
        });
        return NextResponse.json(
          { ok: false, message: "A duplicate post was recently published for this account." },
          { status: 409 },
        );
      }
    }

    const result = await publishDraft(draft, targetAccount);
    const nowStr = DateTime.utc().toISO();

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
      character_version: draft.character_version,
      ...(draft.pattern ? { pattern: draft.pattern } : {}),
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
    const failedDraft = await adminDb.collection("drafts").doc(params.id).get();
    if (failedDraft.exists) {
      await recordPublishFailure(
        { ...failedDraft.data(), id: failedDraft.id } as DraftDoc,
        error,
      ).catch(() => {
        // Keep the original publish error as the API response if logging fails.
      });
    }
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
