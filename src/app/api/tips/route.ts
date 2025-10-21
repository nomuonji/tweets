import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { Tip } from "@/lib/types";

// 全てのTipsを取得
export async function GET() {
  try {
    const snapshot = await adminDb.collection("tips").orderBy("created_at", "desc").get();
    const tips = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Tip[];
    return NextResponse.json({ ok: true, tips });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

// 新しいTipを作成
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, content } = body;

    if (!title || !content) {
      return NextResponse.json(
        { ok: false, message: "Title and content are required." },
        { status: 400 },
      );
    }

    const newTipRef = adminDb.collection("tips").doc();
    const newTip: Omit<Tip, "id"> = {
      title,
      content,
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
