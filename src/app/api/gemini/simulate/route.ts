import { NextResponse } from "next/server";
import { buildPrompt } from "@/lib/gemini/prompt";
import { requestGemini } from "@/lib/gemini/client";
import type { DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";



type GeminiSuggestion = { tweet: string; explanation: string; };
type GeminiFunctionCall = { args?: Record<string, unknown> };
type GeminiPart = { text?: string; functionCall?: GeminiFunctionCall };
type GeminiContent = { parts?: GeminiPart[] };
type GeminiCandidate = { content?: GeminiContent };
type GeminiResponse = { candidates?: GeminiCandidate[] };

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

function sanitizeCandidateText(text: string) {
  return text.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
}

function parseSuggestion(raw: unknown): GeminiSuggestion {
  if (!raw || typeof raw !== "object") throw new Error("Gemini response was empty.");
  const { candidates } = raw as GeminiResponse;
  const candidateParts = candidates?.[0]?.content?.parts ?? [];
  const text = candidateParts.map((part) => part?.text ?? "").join("").trim() ?? "";
  if (!text) {
    const functionArgs = candidateParts.map((part) => part?.functionCall?.args ?? null).filter((args): args is Record<string, unknown> => Boolean(args));
    const candidateArgs = functionArgs.find((args) => typeof args.tweet === "string" && typeof args.explanation === "string") as { tweet?: string; explanation?: string } | undefined;
    if (candidateArgs?.tweet && candidateArgs?.explanation) return { tweet: candidateArgs.tweet, explanation: candidateArgs.explanation };
    throw new Error(`Gemini response did not include any text. Raw snippet: ${JSON.stringify(raw).slice(0, 400)}`);
  }
  const cleaned = sanitizeCandidateText(text);
  try {
    const json = JSON.parse(cleaned);
    if (typeof json.tweet === "string" && typeof json.explanation === "string") return json;
  } catch { }
  const tweetMatch = cleaned.match(/"tweet"\s*:\s*"([^"]+)"/i);
  const explanationMatch = cleaned.match(/"explanation"\s*:\s*"([^"]+)"/i);
  if (tweetMatch && explanationMatch) return { tweet: tweetMatch[1], explanation: explanationMatch[1] };
  const sections = cleaned.split(/\n{2,}/);
  return { tweet: sections[0] ?? cleaned, explanation: sections.slice(1).join("\n\n") || "Failed to extract a reasoning explanation from the model response." };
}



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

    const raw = await requestGemini(prompt);
    const suggestion = parseSuggestion(raw);

    return NextResponse.json({
      ok: true,
      suggestion,
      prompt,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}
