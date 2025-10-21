import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

// お手本投稿を更新
export async function PUT(request: Request, { params }: { params: { id: string, postId: string } }) {
  try {
    const { id, postId } = params;
    const body = await request.json();
    const { text, explanation } = body;

    if (!text || !explanation) {
      return NextResponse.json(
        { ok: false, message: "Text and explanation are required." },
        { status: 400 },
      );
    }

    const postRef = adminDb.collection("accounts").doc(id).collection("exemplary_posts").doc(postId);
    const snapshot = await postRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ ok: false, message: "Post not found." }, { status: 404 });
    }

    const updatedData = {
      text,
      explanation,
      updated_at: new Date().toISOString(),
    };

    await postRef.update(updatedData);

    return NextResponse.json({ ok: true, post: { id: postId, ...snapshot.data(), ...updatedData } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

// お手本投稿を削除
export async function DELETE(request: Request, { params }: { params: { id: string, postId: string } }) {
  try {
    const { id, postId } = params;
    const postRef = adminDb.collection("accounts").doc(id).collection("exemplary_posts").doc(postId);
    const snapshot = await postRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ ok: false, message: "Post not found." }, { status: 404 });
    }

    await postRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
