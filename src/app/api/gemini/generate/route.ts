import { NextResponse } from "next/server";
import { buildPrompt } from "@/lib/gemini/prompt";
import { preparePromptPayload } from "@/lib/services/prompt-service";
import { requestGrok } from "@/lib/grok/client";

const MODEL = "models/gemini-flash-latest";
const GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 4096,
  responseMimeType: "application/json",
};

type GeminiSuggestion = { tweet: string; explanation: string; };
type GeminiFunctionCall = { args?: Record<string, unknown> };
type GeminiPart = { text?: string; functionCall?: GeminiFunctionCall };
type GeminiContent = { parts?: GeminiPart[] };
type GeminiCandidate = { content?: GeminiContent };
type GeminiResponse = { candidates?: GeminiCandidate[] };

type GenerateRequestBody = {
  accountId?: string;
  limit?: number;
};

function sanitizeCandidateText(text: string) {
  return text.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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
  } catch {}
  const tweetMatch = cleaned.match(/"tweet"\s*:\s*"([^"]+)"/i);
  const explanationMatch = cleaned.match(/"explanation"\s*:\s*"([^"]+)"/i);
  if (tweetMatch && explanationMatch) return { tweet: tweetMatch[1], explanation: explanationMatch[1] };
  const sections = cleaned.split(/\n{2,}/);
  return { tweet: sections[0] ?? cleaned, explanation: sections.slice(1).join("\n\n") || "Failed to extract a reasoning explanation from the model response." };
}

async function requestGemini(prompt: string, apiKey: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: GENERATION_CONFIG,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Gemini API request failed with status ${response.status}`);
  }
  return data;
}

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json({ ok: false, message: "GEMINI_API_KEY is not configured." }, { status: 500 });
    }

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
        const raw = await requestGemini(prompt, geminiApiKey);
        suggestion = parseSuggestion(raw);
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