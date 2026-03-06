import { NextResponse } from "next/server";
import { buildPrompt } from "@/lib/gemini/prompt";
import { requestGemini } from "@/lib/gemini/client";
import { parseGeminiResponse, type GeminiSuggestion } from "@/lib/gemini/parser";
import { preparePromptPayload } from "@/lib/services/prompt-service";
import { requestGrok } from "@/lib/grok/client";

type GenerateRequestBody = {
  accountId?: string;
  limit?: number;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function POST(request: Request) {
  try {

    const body = (await request.json()) as GenerateRequestBody;
    const accountId = String(body.accountId ?? "").trim();
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : 15;

    if (!accountId) {
      return NextResponse.json({ ok: false, message: "accountId is required." }, { status: 400 });
    }

    const payload = await preparePromptPayload(accountId, limit);
    const { account, topPosts, referencePosts, recentPosts, drafts, tips, exemplaryPosts } = payload;

    const normalizedDrafts = new Set(drafts.map((draft) => normalizeText(draft.text ?? "")));
    const maxAttempts = 3;
    const extraAvoid: string[] = [];
    let suggestion: GeminiSuggestion | null = null;
    let duplicate = false;
    let finalPrompt = "";

    if (account.r18Mode) {
      const xaiApiKey = process.env.XAI_API_KEY;
      if (!xaiApiKey) {
        return NextResponse.json({ ok: false, message: "XAI_API_KEY environment variable is not configured." }, { status: 500 });
      }

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const prompt = buildPrompt(
          topPosts,
          referencePosts,
          recentPosts,
          drafts,
          extraAvoid,
          tips,
          exemplaryPosts,
          account.concept,
          account.minPostLength,
          account.maxPostLength,
        );
        finalPrompt = prompt;
        suggestion = await requestGrok(prompt, xaiApiKey);
        const normalizedSuggestion = normalizeText(suggestion.tweet);
        duplicate = normalizedDrafts.has(normalizedSuggestion);
        if (!duplicate) break;
        extraAvoid.push(suggestion.tweet);
      }
    } else {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const prompt = buildPrompt(
          topPosts,
          referencePosts,
          recentPosts,
          drafts,
          extraAvoid,
          tips,
          exemplaryPosts,
          account.concept,
          account.minPostLength,
          account.maxPostLength,
        );
        finalPrompt = prompt;
        const raw = await requestGemini(prompt);
        suggestion = parseGeminiResponse(raw);
        const normalizedSuggestion = normalizeText(suggestion.tweet);
        duplicate = normalizedDrafts.has(normalizedSuggestion);
        if (!duplicate) break;
        extraAvoid.push(suggestion.tweet);
      }
    }

    if (!suggestion) {
      throw new Error("Failed to generate suggestion.");
    }

    return NextResponse.json({
      ok: true,
      suggestion,
      duplicate,
      prompt: finalPrompt,
      modelUsed: account.r18Mode ? 'grok' : 'gemini',
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: (error as Error).message }, { status: 500 });
  }
}
