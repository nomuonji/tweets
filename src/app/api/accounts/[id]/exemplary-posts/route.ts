import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { ExemplaryPost } from "@/lib/types";

// アカウントのお手本投稿を全て取得
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const snapshot = await adminDb
      .collection("accounts")
      .doc(id)
      .collection("exemplary_posts")
      .orderBy("created_at", "desc")
      .get();
    const posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as ExemplaryPost[];
    return NextResponse.json({ ok: true, posts });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

// 新しいお手本投稿を作成
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { text, explanation } = body;

    if (!text || !explanation) {
      return NextResponse.json(
        { ok: false, message: "Text and explanation are required." },
        { status: 400 },
      );
    }

    const newPostRef = adminDb.collection("accounts").doc(id).collection("exemplary_posts").doc();
    const newPost: Omit<ExemplaryPost, "id"> = {
      text,
      explanation,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await newPostRef.set(newPost);

    return NextResponse.json({ ok: true, post: { id: newPostRef.id, ...newPost } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
