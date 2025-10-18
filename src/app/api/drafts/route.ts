import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { saveDraft } from "@/lib/services/firestore.server";
import type { DraftDoc } from "@/lib/types";

type CreateDraftPayload = {
  accountId?: string;
  platform?: "x" | "threads";
  text?: string;
  createdBy?: string;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function findDuplicateDraft(accountId: string, normalized: string) {
  const snapshot = await adminDb
    .collection("drafts")
    .where("target_account_id", "==", accountId)
    .get();

  return snapshot.docs.find((doc) => {
    const data = doc.data() as DraftDoc;
    return normalizeText(data.text) === normalized;
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateDraftPayload;
    const accountId = body.accountId?.trim();
    const platform = body.platform ?? "x";
    const text = body.text?.trim();

    if (!accountId || !text) {
      return NextResponse.json(
        { ok: false, message: "accountId と text は必須です。" },
        { status: 400 },
      );
    }

    const normalized = normalizeText(text);
    const duplicate = await findDuplicateDraft(accountId, normalized);
    if (duplicate) {
      return NextResponse.json(
        {
          ok: false,
          message: "同じ内容のドラフトが既に存在します。",
          duplicateDraftId: duplicate.id,
        },
        { status: 409 },
      );
    }

    const now = DateTime.utc().toISO();
    const draftId = `gemini_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const draft: DraftDoc = {
      id: draftId,
      target_platform: platform,
      target_account_id: accountId,
      base_post_id: null,
      text,
      hashtags: [],
      status: "draft",
      schedule_time: null,
      published_at: null,
      created_by: body.createdBy ?? "gemini",
      created_at: now,
      updated_at: now,
      similarity_warning: false,
    };

    await saveDraft(draft);

    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
