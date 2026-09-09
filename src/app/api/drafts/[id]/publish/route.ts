import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { publishExistingDraft } from "@/lib/services/scheduler-service";

/** The dashboard and MCP share the scheduler's lock, recovery, and publish path. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const snapshot = await adminDb.collection("drafts").doc(params.id).get();
    if (!snapshot.exists) return NextResponse.json({ ok: false, message: "Draft not found" }, { status: 404 });
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : snapshot.data()?.updated_at;
    if (typeof expectedUpdatedAt !== "string") throw new Error("Draft is missing updated_at.");
    return NextResponse.json({ ok: true, publishedPost: await publishExistingDraft(params.id, expectedUpdatedAt) });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ ok: false, message }, { status: /conflict|locked|old character|matching post/i.test(message) ? 409 : 500 });
  }
}
