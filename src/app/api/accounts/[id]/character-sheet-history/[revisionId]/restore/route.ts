import { NextResponse } from "next/server";
import { restoreCharacterSheet } from "@/lib/services/account-service";

export async function POST(
  _request: Request,
  { params }: { params: { id: string; revisionId: string } },
) {
  try {
    const restored = await restoreCharacterSheet(params.id, params.revisionId);
    return NextResponse.json({ ok: true, restored });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
