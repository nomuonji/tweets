import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

// Tipを更新
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { title, content } = body;

    if (!title || !content) {
      return NextResponse.json(
        { ok: false, message: "Title and content are required." },
        { status: 400 },
      );
    }

    const tipRef = adminDb.collection("tips").doc(id);
    const snapshot = await tipRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ ok: false, message: "Tip not found." }, { status: 404 });
    }

    const updatedData = {
      title,
      content,
      updated_at: new Date().toISOString(),
    };

    await tipRef.update(updatedData);

    return NextResponse.json({ ok: true, tip: { id, ...snapshot.data(), ...updatedData } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

// Tipを削除
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const tipRef = adminDb.collection("tips").doc(id);
    const snapshot = await tipRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ ok: false, message: "Tip not found." }, { status: 404 });
    }

    await tipRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
