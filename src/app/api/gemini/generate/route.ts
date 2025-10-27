import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { AccountDoc, DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";
import { buildPrompt } from "@/lib/gemini/prompt";

const MODEL = "models/gemini-flash-latest";
const GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 4096,
  responseMimeType: "application/json",
};

// (Existing type definitions: GeminiSuggestion, etc. - unchanged)

type GeminiSuggestion = {
  tweet: string;
  explanation: string;
};

type GeminiFunctionCall = { args?: Record<string, unknown> };
type GeminiPart = { text?: string; functionCall?: GeminiFunctionCall };
type GeminiContent = { parts?: GeminiPart[] };
type GeminiCandidate = { content?: GeminiContent };
type GeminiResponse = { candidates?: GeminiCandidate[] };

type GenerateRequestBody = {
  accountId?: string;
  limit?: number;
};


// (Existing utility functions: sanitizeCandidateText, normalizeText, parseSuggestion - unchanged)
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

  const tweetMatch = cleaned.match(/"tweet"\s*:\s*"([^"]+)"/i);
  const explanationMatch = cleaned.match(/"explanation"\s*:\s*"([^"]+)"/i);

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

// (Existing fetch functions: fetchTopPosts, fetchRecentPosts, fetchExistingDrafts - unchanged)
async function fetchTopPosts(accountId: string, limit: number) {
  const snapshot = await adminDb
    .collection("posts")
    .where("account_id", "==", accountId)
    .orderBy("score", "desc")
    .limit(30)
    .get();

  const posts = snapshot.docs.map((doc) => {
    const data = doc.data() as PostDoc;
    return { ...data, id: doc.id };
  });

  // Fisher-Yates shuffle to get random posts from the top 30
  for (let i = posts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [posts[i], posts[j]] = [posts[j], posts[i]];
  }

  return posts.slice(0, limit);
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

// New fetch functions
async function fetchAccount(accountId: string): Promise<AccountDoc | null> {
    const doc = await adminDb.collection("accounts").doc(accountId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as AccountDoc;
}

async function fetchSelectedTips(tipIds: string[]): Promise<Tip[]> {
    if (tipIds.length === 0) return [];
    const snapshot = await adminDb.collection("tips").where("__name__", "in", tipIds).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Tip[];
}

async function fetchExemplaryPosts(accountId: string): Promise<ExemplaryPost[]> {
    const snapshot = await adminDb.collection("accounts").doc(accountId).collection("exemplary_posts").orderBy("created_at", "desc").limit(10).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ExemplaryPost[];
}

async function fetchReferencePosts(accountId: string, limit: number): Promise<Tip[]> {
    const snapshot = await adminDb
      .collection("tips")
      .where("account_ids", "array-contains", accountId)
      .get();

    const tips = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Tip[];

    // Fisher-Yates shuffle
    for (let i = tips.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tips[i], tips[j]] = [tips[j], tips[i]];
    }

    return tips.slice(0, limit);
}



// (dedupePostSets and requestGemini functions are unchanged)
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


// Updated POST handler
export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json(
        { ok: false, message: "GEMINI_API_KEY is not configured." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as GenerateRequestBody;
    const accountId = String(body.accountId ?? "").trim();
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : 15;

    if (!accountId) {
      return NextResponse.json(
        { ok: false, message: "accountId is required." },
        { status: 400 },
      );
    }

    // Fetch all data in parallel
    const account = await fetchAccount(accountId);
    if (!account) {
        return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    }

    const normalizedLimit = Math.min(Math.max(limit, 6), 40);
    const perCategoryLimit = Math.min(Math.max(Math.ceil(normalizedLimit / 2), 3), 20);

    const [topPosts, referencePosts, recentPosts, drafts, tips, exemplaryPosts] = await Promise.all([
        fetchTopPosts(accountId, 3),
        fetchReferencePosts(accountId, 3),
        fetchRecentPosts(accountId, perCategoryLimit),
        fetchExistingDrafts(accountId, 50),
        fetchSelectedTips(account.selectedTipIds || []),
        fetchExemplaryPosts(accountId),
    ]);

    if (recentPosts.length === 0) {
      return NextResponse.json(
        { ok: false, message: "No posts found for this account yet. Run a sync first." },
        { status: 400 },
      );
    }

    const normalizedDrafts = new Set(
      drafts.map((draft) => normalizeText(draft.text ?? "")),
    );

    const maxAttempts = 3;
    const extraAvoid: string[] = [];
    let suggestion: GeminiSuggestion | null = null;
    let duplicate = false;
    let finalPrompt = ""; // Variable to hold the prompt

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const prompt = buildPrompt(topPosts, referencePosts, recentPosts, drafts, extraAvoid, tips, exemplaryPosts, account.concept);
      finalPrompt = prompt; // Capture the prompt
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

    // (Return response is largely unchanged)
    return NextResponse.json({
      ok: true,
      suggestion,
      duplicate,
      prompt: finalPrompt, // Add the prompt to the response
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}