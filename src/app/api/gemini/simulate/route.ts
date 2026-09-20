import { NextResponse } from "next/server";
import { buildPrompt } from "@/lib/gemini/prompt";
import { generateSuggestion } from "@/lib/ai/generation-client";
import type { DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";

export type SimulateRequestBody = {
  prompt?: string;
  concept?: string;
  topPosts?: PostDoc[];
  referencePosts?: Tip[];
  recentPosts?: PostDoc[];
  drafts?: DraftDoc[];
  tips?: Tip[];
  exemplaryPosts?: ExemplaryPost[];
};

export async function POST(request: Request) {
  try {

    const body = (await request.json()) as SimulateRequestBody;

    const prompt = body.prompt ?? buildPrompt(
      body.topPosts ?? [],
      body.referencePosts ?? [],
      body.recentPosts ?? [],
      body.drafts ?? [],
      [],
      body.tips ?? [],
      body.exemplaryPosts ?? [],
      body.concept
    );

    const generated = await generateSuggestion(prompt);

    return NextResponse.json({
      ok: true,
      suggestion: generated.value,
      modelUsed: generated.provider,
      prompt,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}
