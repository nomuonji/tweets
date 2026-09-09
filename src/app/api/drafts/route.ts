import { NextResponse } from "next/server";
import { createAgentDrafts } from "@/lib/services/draft-service";

type CreateDraftPayload = {
  accountId?: string;
  platform?: "x" | "threads";
  text?: string;
  createdBy?: string;
  generatedBy?: string;
  promoProductId?: string;
  promoProductAsin?: string;
  characterVersion?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateDraftPayload;
    const accountId = body.accountId?.trim();
    const text = body.text?.trim();

    if (!accountId || !text) {
      return NextResponse.json(
        { ok: false, message: "accountId と text は必須です。" },
        { status: 400 },
      );
    }

    if (body.characterVersion == null) {
      return NextResponse.json(
        { ok: false, message: "characterVersion は必須です。" }, { status: 400 },
      );
    }
    const [draft] = await createAgentDrafts(accountId, body.characterVersion, [{ text, createdBy: body.createdBy ?? "gemini", generatedBy: body.generatedBy ?? "gemini" }]);

    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
