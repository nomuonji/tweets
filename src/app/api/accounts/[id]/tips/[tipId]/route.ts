import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

// Update a tip
export async function PUT(request: Request, { params }: { params: { id: string, tipId: string } }) {
  try {
    const { id, tipId } = params;
    const body = await request.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json(
        { ok: false, message: "Text is required." },
        { status: 400 },
      );
    }

    const tipRef = adminDb.collection("accounts").doc(id).collection("tips").doc(tipId);
    const snapshot = await tipRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ ok: false, message: "Tip not found." }, { status: 404 });
    }

    const updatedData = {
      text,
      updated_at: new Date().toISOString(),
    };

    await tipRef.update(updatedData);

    return NextResponse.json({ ok: true, tip: { id: tipId, ...snapshot.data(), ...updatedData } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

// Delete a tip
export async function DELETE(request: Request, { params }: { params: { id: string, tipId: string } }) {
  try {
    const { id, tipId } = params;
    const tipRef = adminDb.collection("accounts").doc(id).collection("tips").doc(tipId);
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
