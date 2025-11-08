import { NextResponse } from "next/server";
import { buildPrompt } from "@/lib/gemini/prompt";
import type { SimulateRequestBody } from "@/app/api/gemini/simulate/route";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SimulateRequestBody;

    const prompt = buildPrompt(
      body.topPosts ?? [],
      body.referencePosts ?? [],
      body.recentPosts ?? [],
      body.drafts ?? [],
      [], // extraAvoid is not needed for preview
      body.tips ?? [],
      body.exemplaryPosts ?? [],
      body.concept
    );

    return NextResponse.json({ ok: true, prompt });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
