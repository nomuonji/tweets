import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";

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

    const updateData: { [key: string]: any } = {
      updated_at: DateTime.utc().toISO(),
    };

    if (text) {
      updateData.text = text;
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