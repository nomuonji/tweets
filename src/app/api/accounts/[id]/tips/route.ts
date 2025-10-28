import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { Tip, Platform } from "@/lib/types";
import { getAllTips } from "@/lib/services/firestore.server";

// Get all tips for an account
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const snapshot = await adminDb
      .collection("accounts")
      .doc(id)
      .collection("tips")
      .orderBy("created_at", "desc")
      .get();

    if (!snapshot.empty) {
      const tips = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Tip[];
      return NextResponse.json({ ok: true, tips });
    }

    // If no account-specific tips, return global tips
    const globalTips = await getAllTips();
    return NextResponse.json({ ok: true, tips: globalTips });

  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

// Create a new tip
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json(
        { ok: false, message: "Text is required." },
        { status: 400 },
      );
    }

    const newTipRef = adminDb.collection("accounts").doc(id).collection("tips").doc();
    const newTip: Omit<Tip, "id"> = {
      text,
      title: text.substring(0, 40),
      platform: '' as Platform,
      url: '',
      author_handle: '',
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