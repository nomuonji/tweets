import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc, PostDoc } from "@/lib/types";

const MODEL = "models/gemini-flash-latest";
const GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 4096,
  responseMimeType: "application/json",
};

type GeminiSuggestion = {
  tweet: string;
  explanation: string;
};

type GeminiFunctionCall = { args?: Record<string, unknown> };
type GeminiPart = { text?: string; functionCall?: GeminiFunctionCall };
type GeminiContent = { parts?: GeminiPart[] };
type GeminiCandidate = { content?: GeminiContent };
type GeminiResponse = { candidates?: GeminiCandidate[] };

type AnalysisMode = "top" | "recent";

type GenerateRequestBody = {
  accountId?: string;
  limit?: number;
  analysisMode?: AnalysisMode;
};

function sanitizeCandidateText(text: string) {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseSuggestion(raw: unknown): GeminiSuggestion {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gemini response was empty.");
  }

  const { candidates } = raw as GeminiResponse;
  const candidateParts = candidates?.[0]?.content?.parts ?? [];
  const text =
    candidateParts
      .map((part) => part?.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    const functionArgs = candidateParts
      .map((part) => part?.functionCall?.args ?? null)
      .filter((args): args is Record<string, unknown> => Boolean(args));

    const candidateArgs = functionArgs.find(
      (args) => typeof args.tweet === "string" && typeof args.explanation === "string",
    ) as { tweet?: string; explanation?: string } | undefined;

    if (candidateArgs?.tweet && candidateArgs?.explanation) {
      return {
        tweet: candidateArgs.tweet,
        explanation: candidateArgs.explanation,
      };
    }

    throw new Error(
      `Gemini response did not include any text. Raw snippet: ${JSON.stringify(
        raw,
      ).slice(0, 400)}`,
    );
  }

  const cleaned = sanitizeCandidateText(text);

  try {
    const json = JSON.parse(cleaned);
    if (typeof json.tweet === "string" && typeof json.explanation === "string") {
      return json;
    }
  } catch {
    // fall back to heuristic parsing
  }

  const tweetMatch = cleaned.match(/"tweet"\s*:\s*"([^\"]+)"/i);
  const explanationMatch = cleaned.match(/"explanation"\s*:\s*"([^\"]+)"/i);

  if (tweetMatch && explanationMatch) {
    return {
      tweet: tweetMatch[1],
      explanation: explanationMatch[1],
    };
  }

  const sections = cleaned.split(/\n{2,}/);
  return {
    tweet: sections[0] ?? cleaned,
    explanation:
      sections.slice(1).join("\n\n") ||
      "Failed to extract a reasoning explanation from the model response.",
  };
}

async function fetchTopPosts(accountId: string, limit: number) {
  try {
    const snapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .orderBy("score", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as PostDoc;
      return { ...data, id: doc.id };
    });
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!message.includes("requires an index")) {
      throw error;
    }

    const fallbackSnapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .get();

    const posts = fallbackSnapshot.docs.map((doc) => {
      const data = doc.data() as PostDoc;
      return { ...data, id: doc.id };
    });

    return posts.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

async function fetchRecentPosts(accountId: string, limit: number) {
  try {
    const snapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as PostDoc;
      return { ...data, id: doc.id };
    });
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!message.includes("requires an index")) {
      throw error;
    }

    const fallbackSnapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .get();

    const posts = fallbackSnapshot.docs.map((doc) => {
      const data = doc.data() as PostDoc;
      return { ...data, id: doc.id };
    });

    return posts
      .sort(
        (a, b) =>
          DateTime.fromISO(b.created_at).toMillis() -
          DateTime.fromISO(a.created_at).toMillis(),
      )
      .slice(0, limit);
  }
}

async function fetchExistingDrafts(accountId: string, limit: number) {
  try {
    const snapshot = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", accountId)
      .orderBy("updated_at", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as DraftDoc;
      return { ...data, id: doc.id };
    });
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!message.includes("requires an index")) {
      throw error;
    }

    const fallbackSnapshot = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", accountId)
      .get();

    const drafts = fallbackSnapshot.docs.map((doc) => {
      const data = doc.data() as DraftDoc;
      return { ...data, id: doc.id };
    });

    return drafts
      .sort(
        (a, b) =>
          DateTime.fromISO(b.updated_at).toMillis() -
          DateTime.fromISO(a.updated_at).toMillis(),
      )
      .slice(0, limit);
  }
}

function buildPrompt(
  posts: PostDoc[],
  drafts: DraftDoc[],
  extraAvoid: string[],
  mode: AnalysisMode,
) {
  const summaryLines = posts.map((post, index) => {
    const created = DateTime.fromISO(post.created_at).toFormat("yyyy-LL-dd");
    const impressions = post.metrics.impressions ?? 0;
    return [
      `${index + 1}. ${created} @${post.account_id}`,
      `   Text: ${post.text}`,
      `   Metrics: impressions=${impressions}, likes=${post.metrics.likes}, reposts=${post.metrics.reposts_or_rethreads}, replies=${post.metrics.replies}, score=${post.score.toFixed(3)}`,
    ].join("\n");
  });

  const avoidList = Array.from(
    new Set(
      [...drafts.map((draft) => draft.text), ...extraAvoid]
        .filter(Boolean)
        .map((text) => text.trim()),
    ),
  )
    .slice(0, 20)
    .map((text) => `- ${text.replace(/\s+/g, " ").slice(0, 120)}`);

  const avoidBlock =
    avoidList.length > 0
      ? `\nAvoid repeating these existing drafts or suggesting something semantically identical:\n${avoidList.join(
          "\n",
        )}\n`
      : "";

  const datasetDescription =
    mode === "recent"
      ? "The following list shows the most recent posts (newest first)."
      : "The following list shows top-performing posts ranked by engagement score.";

  return `
You are an experienced social media strategist for short form posts on X (Twitter).

You will receive a list of recent high performing posts including their engagement metrics.
Identify the stylistic patterns, tone, and topics that deliver the best engagement.
Then write a brand new post idea that stays consistent with the brand voice but introduces a fresh angle.

Output requirements (strict):
- Respond ONLY with a single JSON object exactly like {"tweet":"...", "explanation":"..."}.
- "tweet": the new post text (<= 260 characters, no surrounding quotes).
- "explanation": concise reasoning in Japanese (<= 200 characters) referencing observed metrics or stylistic cues.
- Keep the tone in Japanese if the prior examples are in Japanese. Preserve useful emoji or punctuation patterns.
- Do not add any additional fields, markdown, or commentary.
- Avoid repeating existing draft texts or their close variations.

${datasetDescription}
Here are the reference posts:
${summaryLines.join("\n")}
${avoidBlock}
Respond only with JSON.`;
}

async function requestGemini(prompt: string, apiKey: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${encodeURIComponent(
      apiKey,
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: GENERATION_CONFIG,
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ?? `Gemini API request failed with status ${response.status}`,
    );
  }

  return data;
}

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "GEMINI_API_KEY is not configured. Set it in your environment before using this feature.",
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as GenerateRequestBody;
    const accountId = String(body.accountId ?? "").trim();
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : 15;
    const requestedMode = body.analysisMode === "recent" ? "recent" : "top";

    if (!accountId) {
      return NextResponse.json(
        { ok: false, message: "accountId is required." },
        { status: 400 },
      );
    }

    const fetchLimit = Math.min(Math.max(limit, 5), 50);
    const posts =
      requestedMode === "recent"
        ? await fetchRecentPosts(accountId, fetchLimit)
        : await fetchTopPosts(accountId, fetchLimit);

    if (posts.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "No posts found for this account yet. Run a sync first.",
        },
        { status: 400 },
      );
    }

    const drafts = await fetchExistingDrafts(accountId, 50);
    const normalizedDrafts = new Set(
      drafts.map((draft) => normalizeText(draft.text ?? "")),
    );

    const maxAttempts = 3;
    const extraAvoid: string[] = [];
    let suggestion: GeminiSuggestion | null = null;
    let duplicate = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const prompt = buildPrompt(posts, drafts, extraAvoid, requestedMode);
      const raw = await requestGemini(prompt, geminiApiKey);
      suggestion = parseSuggestion(raw);
      const normalizedSuggestion = normalizeText(suggestion.tweet);
      duplicate = normalizedDrafts.has(normalizedSuggestion);
      if (!duplicate) {
        break;
      }
      extraAvoid.push(suggestion.tweet);
    }

    if (!suggestion) {
      throw new Error("Failed to generate suggestion.");
    }

    return NextResponse.json({
      ok: true,
      suggestion,
      duplicate,
      context: {
        analysisMode: requestedMode,
        usedPosts: posts.slice(0, 5).map((post) => ({
          id: post.id,
          text: post.text,
          score: post.score,
          impressions: post.metrics.impressions ?? 0,
          likes: post.metrics.likes,
          reposts: post.metrics.reposts_or_rethreads,
          replies: post.metrics.replies,
        })),
        existingDrafts: drafts.slice(0, 8).map((draft) => ({
          id: draft.id,
          text: draft.text,
          updatedAt: draft.updated_at,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
