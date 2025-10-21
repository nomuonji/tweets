import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

// アカウントに紐づくTipsを更新
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { selectedTipIds } = body;

    if (!Array.isArray(selectedTipIds)) {
      return NextResponse.json(
        { ok: false, message: "selectedTipIds must be an array." },
        { status: 400 },
      );
    }

    const accountRef = adminDb.collection("accounts").doc(id);
    const snapshot = await accountRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    }

    await accountRef.update({
      selectedTipIds,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
