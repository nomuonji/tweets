import { NextResponse } from "next/server";
import { listCharacterSheetHistory } from "@/lib/services/account-service";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const revisions = await listCharacterSheetHistory(params.id);
    return NextResponse.json({ ok: true, revisions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
