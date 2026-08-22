import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc } from "@/lib/types";
import { getCharacterVersion } from "@/lib/character-version";

async function currentVersionForDraft(draftId: string): Promise<number | null> {
  const draftSnapshot = await adminDb.collection("drafts").doc(draftId).get();
  if (!draftSnapshot.exists) return null;
  const draft = draftSnapshot.data() as DraftDoc;
  if (!draft.target_account_id) return null;
  const accountSnapshot = await adminDb
    .collection("accounts")
    .doc(draft.target_account_id)
    .get();
  return accountSnapshot.exists
    ? getCharacterVersion(accountSnapshot.data() ?? {})
    : null;
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json(
        { ok: false, message: "ID is required" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { text, status } = body;

    const updateData: Record<string, unknown> = {
      updated_at: DateTime.utc().toISO(),
    };

    if (text) {
      updateData.text = text;
      const characterVersion = await currentVersionForDraft(id);
      if (characterVersion != null) {
        updateData.character_version = characterVersion;
        updateData.last_error = null;
      }
    }

    if (status) {
      updateData.status = status;
    }

    await adminDb.collection("drafts").doc(id).set(updateData, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

type RouteParams = {
  params: {
    id: string;
  };
};

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_at: DateTime.utc().toISO(),
    };

    if (typeof body.text === "string") {
      updates.text = body.text;
      const characterVersion = await currentVersionForDraft(params.id);
      if (characterVersion != null) {
        updates.character_version = characterVersion;
        updates.last_error = null;
      }
    }
    if (Array.isArray(body.hashtags)) {
      updates.hashtags = body.hashtags;
    }
    if (typeof body.status === "string") {
      updates.status = body.status;
    }
    if (body.schedule_time) {
      updates.schedule_time = body.schedule_time;
    }

    await adminDb
      .collection("drafts")
      .doc(params.id)
      .set(updates, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json(
        { ok: false, message: "ID is required" },
        { status: 400 },
      );
    }

    await adminDb.collection("drafts").doc(id).delete();

    return NextResponse.json({ ok: true, message: "Draft deleted successfully" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
