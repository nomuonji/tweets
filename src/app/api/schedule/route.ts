import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getSettings } from "@/lib/services/firestore.server";
import { slotToIso } from "@/lib/services/slot-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draftId = body.draftId as string;
    const slotKey = body.slotKey as string;
    const platform = body.platform as "x" | "threads";
    const accountId = body.accountId as string | undefined;

    if (!draftId || !slotKey || !platform) {
      return NextResponse.json(
        { ok: false, message: "draftId, slotKey, and platform are required" },
        { status: 400 },
      );
    }

    const settings = await getSettings();
    if (!settings) {
      return NextResponse.json(
        { ok: false, message: "Settings not found" },
        { status: 400 },
      );
    }

    const timezone = settings.timezone ?? process.env.TIMEZONE ?? "Asia/Tokyo";
    const scheduleTime = slotToIso(slotKey, timezone);

    const collisionSnapshot = await adminDb
      .collection("drafts")
      .where("target_platform", "==", platform)
      .where("status", "==", "scheduled")
      .where("schedule_time", "==", scheduleTime)
      .get();

    if (!collisionSnapshot.empty) {
      return NextResponse.json(
        { ok: false, message: "Slot already reserved" },
        { status: 409 },
      );
    }

    await adminDb.collection("drafts").doc(draftId).set(
      {
        target_platform: platform,
        target_account_id: accountId,
        status: "scheduled",
        schedule_time: scheduleTime,
        updated_at: DateTime.utc().toISO(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, schedule_time: scheduleTime });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
