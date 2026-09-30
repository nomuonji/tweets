import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listInspirationAccounts,
  saveInspirationAccount,
} from "@/lib/services/inspiration-account-service";

const platform = z.enum([
  "x",
  "threads",
  "instagram",
  "tiktok",
  "youtube",
  "other",
]);
const status = z.enum(["active", "paused", "archived"]);
const priority = z.enum(["low", "normal", "high"]);

const saveSchema = z.object({
  platform,
  handle: z.string().trim().min(1).max(200),
  display_name: z.string().trim().max(300).optional(),
  profile_url: z.union([z.string().url().max(1500), z.literal("")]).optional(),
  status: status.optional(),
  watch_priority: priority.optional(),
  why_useful: z.string().trim().max(3000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  themes: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  target_account_ids: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
  notes: z.string().trim().max(5000).optional(),
  source: z.string().trim().max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const platformValue = url.searchParams.get("platform");
    const statusValue = url.searchParams.get("status");
    const limitValue = Number(url.searchParams.get("limit") ?? "200");
    const items = await listInspirationAccounts({
      platform: platformValue ? platform.parse(platformValue) : undefined,
      status: statusValue ? status.parse(statusValue) : undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      targetAccountId: url.searchParams.get("targetAccountId") ?? undefined,
      query: url.searchParams.get("q") ?? undefined,
      limit: Number.isFinite(limitValue) ? limitValue : 200,
    });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = saveSchema.parse(await request.json());
    const saved = await saveInspirationAccount({ account });
    return NextResponse.json({ ok: true, account: saved });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
