import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { preparePromptPayload } from "@/lib/services/gemini-service";
import { upsertAccount } from "@/lib/services/account-service";
import type { AccountDoc } from "@/lib/types";

// アカウント一覧を取得
async function getAccounts() {
  const snapshot = await adminDb.collection("accounts").orderBy("id", "asc").get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as AccountDoc[];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");

    if (accountId) {
      // 特定のアカウントの詳細情報を取得
      const payload = await preparePromptPayload(accountId);
      return NextResponse.json({ ok: true, accountDetails: payload });
    } else {
      // アカウント一覧を取得
      const accounts = await getAccounts();
      return NextResponse.json({ ok: true, accounts });
    }
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}

const tokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.string().optional(),
  consumerKey: z.string().optional(),
  consumerSecret: z.string().optional(),
  accessTokenSecret: z.string().optional(),
  oauthVersion: z.enum(["oauth2", "oauth1"]).optional(),
  apiKey: z.string().optional(),
  apiHost: z.string().optional(),
  userId: z.string().optional(),
});

const postPayloadSchema = z.object({
  platform: z.enum(["x", "threads"]),
  handle: z.string(),
  displayName: z.string(),
  scopes: z.array(z.string()),
  token: tokenSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const data = postPayloadSchema.parse(json);
    await upsertAccount(data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, message: "Payload validation failed.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}
