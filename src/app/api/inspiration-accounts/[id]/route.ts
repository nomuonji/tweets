import { NextResponse } from "next/server";
import { z } from "zod";
import {
  archiveInspirationAccount,
  getInspirationAccount,
  saveInspirationAccount,
} from "@/lib/services/inspiration-account-service";

const patchSchema = z.object({
  expectedUpdatedAt: z.string().trim().min(1),
  changes: z.object({
    display_name: z.string().trim().max(300).optional(),
    profile_url: z.union([z.string().url().max(1500), z.literal("")]).optional(),
    status: z.enum(["active", "paused", "archived"]).optional(),
    watch_priority: z.enum(["low", "normal", "high"]).optional(),
    why_useful: z.string().trim().max(3000).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    themes: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
    target_account_ids: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
    notes: z.string().trim().max(5000).optional(),
    last_reviewed_at: z.string().trim().max(64).optional(),
  }),
});

const archiveSchema = z.object({
  expectedUpdatedAt: z.string().trim().min(1),
  reason: z.string().trim().max(1000).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const account = await getInspirationAccount(params.id);
  if (!account) {
    return NextResponse.json(
      { ok: false, message: "参考アカウントが見つかりません。" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, account });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = patchSchema.parse(await request.json());
    const account = await saveInspirationAccount({
      id: params.id,
      expectedUpdatedAt: input.expectedUpdatedAt,
      account: input.changes,
    });
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: error instanceof z.ZodError ? 400 : 409 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = archiveSchema.parse(await request.json());
    const account = await archiveInspirationAccount(
      params.id,
      input.expectedUpdatedAt,
      input.reason,
    );
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: error instanceof z.ZodError ? 400 : 409 },
    );
  }
}
