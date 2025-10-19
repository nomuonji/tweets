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

type GenerateRequestBody = {
  accountId?: string;
  limit?: number;
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

function formatPostSummary(posts: PostDoc[]) {
  return posts.map((post, index) => {
    const created = DateTime.fromISO(post.created_at).toFormat("yyyy-LL-dd");
    const impressions = post.metrics.impressions ?? 0;
    return [
      `${index + 1}. ${created} @${post.account_id}`,
      `   Text: ${post.text}`,
      `   Metrics: impressions=${impressions}, likes=${post.metrics.likes}, reposts=${post.metrics.reposts_or_rethreads}, replies=${post.metrics.replies}, score=${post.score.toFixed(3)}`,
    ].join("\n");
  });
}

function buildPrompt(
  topPosts: PostDoc[],
  recentPosts: PostDoc[],
  drafts: DraftDoc[],
  extraAvoid: string[],
) {
  const topSummary = topPosts.length
    ? `Top performing posts ranked by engagement:\n${formatPostSummary(topPosts).join("\n")}`
    : "Top performing posts ranked by engagement:\n- No historical high performers available.";

  const recentSummary = recentPosts.length
    ? `Latest posts (newest first):\n${formatPostSummary(recentPosts).join("\n")}`
    : "Latest posts (newest first):\n- No recent posts available.";

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

  return `
You are an experienced social media strategist for short form posts on X (Twitter).

You will receive two datasets: high performing posts that achieved strong engagement, and the most recent posts. Study both to understand winning themes while avoiding repetition with the latest content.
Then write a brand new post idea that stays consistent with the brand voice but introduces a fresh angle that has not appeared in the recent posts.

Output requirements (strict):
- Respond ONLY with a single JSON object exactly like {"tweet":"...", "explanation":"..."}.
- "tweet": the new post text (<= 260 characters, no surrounding quotes).
- "explanation": concise reasoning in Japanese (<= 200 characters) referencing observed metrics or stylistic cues.
- Keep the tone in Japanese if the prior examples are in Japanese. Preserve useful emoji or punctuation patterns.
- Do not add any additional fields, markdown, or commentary.
- Avoid repeating existing draft texts or their close variations.

Here are the reference posts:

${topSummary}

${recentSummary}
${avoidBlock}
Respond only with JSON.`;
}

function dedupePostSets(topPosts: PostDoc[], recentPosts: PostDoc[]) {
  const seen = new Set<string>();

  const uniqueTop = topPosts.filter((post) => {
    const key = post.id ?? `${post.platform}_${post.platform_post_id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const uniqueRecent = recentPosts.filter((post) => {
    const key = post.id ?? `${post.platform}_${post.platform_post_id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return { uniqueTop, uniqueRecent };
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

    if (!accountId) {
      return NextResponse.json(
        { ok: false, message: "accountId is required." },
        { status: 400 },
      );
    }

    const normalizedLimit = Math.min(Math.max(limit, 6), 40);
    const perCategoryLimit = Math.min(Math.max(Math.ceil(normalizedLimit / 2), 3), 20);

    const rawTopPosts = await fetchTopPosts(accountId, perCategoryLimit);
    const rawRecentPosts = await fetchRecentPosts(accountId, perCategoryLimit);
    const { uniqueTop, uniqueRecent } = dedupePostSets(rawTopPosts, rawRecentPosts);

    if (uniqueTop.length === 0 && uniqueRecent.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "No posts found for this account yet. Run a sync first.",
        },
        { status: 400 },
      );
    }

    const referenceTop = uniqueTop.slice(0, perCategoryLimit);
    const referenceRecent = uniqueRecent.slice(0, perCategoryLimit);
    const referenceEntries = [
      ...referenceTop.map((post) => ({ post, source: "top" as const })),
      ...referenceRecent.map((post) => ({ post, source: "recent" as const })),
    ];

    const drafts = await fetchExistingDrafts(accountId, 50);
    const normalizedDrafts = new Set(
      drafts.map((draft) => normalizeText(draft.text ?? "")),
    );

    const maxAttempts = 3;
    const extraAvoid: string[] = [];
    let suggestion: GeminiSuggestion | null = null;
    let duplicate = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const prompt = buildPrompt(referenceTop, referenceRecent, drafts, extraAvoid);
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
        usedPosts: referenceEntries.slice(0, 10).map(({ post, source }) => ({
          id: post.id,
          text: post.text,
          score:
            typeof post.score === "number" && Number.isFinite(post.score)
              ? post.score
              : 0,
          impressions:
            typeof post.metrics.impressions === "number" &&
            Number.isFinite(post.metrics.impressions)
              ? post.metrics.impressions
              : 0,
          likes:
            typeof post.metrics.likes === "number" && Number.isFinite(post.metrics.likes)
              ? post.metrics.likes
              : 0,
          reposts:
            typeof post.metrics.reposts_or_rethreads === "number" &&
            Number.isFinite(post.metrics.reposts_or_rethreads)
              ? post.metrics.reposts_or_rethreads
              : 0,
          replies:
            typeof post.metrics.replies === "number" &&
            Number.isFinite(post.metrics.replies)
              ? post.metrics.replies
              : 0,
          source,
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
