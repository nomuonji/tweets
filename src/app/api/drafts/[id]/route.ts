import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";

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
