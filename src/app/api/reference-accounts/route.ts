import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { saveReferenceAccount } from "@/lib/services/firestore.server";
import type { ReferenceAccountDoc } from "@/lib/types";

const schema = z.object({
  handle: z.string().trim().regex(/^@?[A-Za-z0-9_]{1,15}$/),
  sourceKeyword: z.string().trim().max(100).optional(),
});

export async function GET() {
  const snapshot = await adminDb.collection("reference_accounts").get();
  const accounts = snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as ReferenceAccountDoc,
  );
  return NextResponse.json({ ok: true, accounts });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const handle = input.handle.replace(/^@/, "");
    const now = DateTime.utc().toISO()!;
    const account: ReferenceAccountDoc = {
      id: `x_${handle.toLowerCase()}`,
      platform: "x",
      handle,
      status: "approved",
      source_keyword: input.sourceKeyword,
      created_at: now,
      updated_at: now,
    };
    await saveReferenceAccount(account);
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, message: "Xのユーザー名を入力してください。" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}
