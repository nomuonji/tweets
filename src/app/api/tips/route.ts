import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { Tip } from "@/lib/types";
import { getAllTips } from "@/lib/services/firestore.server";

export async function GET() {
  try {
    const tips = await getAllTips();
    return NextResponse.json({ ok: true, tips });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, platform, url, author_handle, title } = body;

    if (!text) {
      return NextResponse.json(
        { ok: false, message: "Text is required." },
        { status: 400 },
      );
    }

    const newTipRef = adminDb.collection("tips").doc();
    const newTip: Omit<Tip, "id" | "account_ids"> = {
      title: title || text.substring(0, 40),
      text,
      platform: platform || '',
      url: url || '',
      author_handle: author_handle || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await newTipRef.set(newTip);

    return NextResponse.json({ ok: true, tip: { id: newTipRef.id, ...newTip } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}