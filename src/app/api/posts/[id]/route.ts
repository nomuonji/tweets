import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

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

    await adminDb.collection("posts").doc(id).delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
