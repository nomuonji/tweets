import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { AccountDoc, DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";

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

function formatReferencePosts(posts: Tip[]) {
  return posts.map((post, index) => {
    return [
      `${index + 1}. @${post.author_handle} on ${post.platform}`,
      `   Text: ${post.text}`,
    ].join("\n");
  });
}

// Updated buildPrompt function
function buildPrompt(
  referencePosts: Tip[],
  recentPosts: PostDoc[],
  drafts: DraftDoc[],
  extraAvoid: string[],
  tips: Tip[],
  exemplaryPosts: ExemplaryPost[]
) {
  const referenceSummary = referencePosts.length
    ? `Here are some reference posts for inspiration. Do not copy them, but learn from their style and topics:\n${formatReferencePosts(referencePosts).join("\n")}`
    : "No reference posts provided.";

  const recentSummary = recentPosts.length
    ? `Latest posts (newest first):\n${formatPostSummary(recentPosts).join("\n")}`
    : "Latest posts (newest first):\n- No recent posts available.";

  const tipsBlock = tips.length > 0
    ? `\nGeneral guidance and tips for writing effective posts:\n${tips.map(tip => `- ${tip.text}`).join("\n")}\n`
    : "";

  const exemplaryBlock = exemplaryPosts.length > 0
    ? `\nStudy these exemplary posts for style and tone:\n${exemplaryPosts.map(p => `Post: ${p.text}\nReasoning: ${p.explanation}`).join("\n\n")}\n`
    : "";

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
  
  const targetLength = Math.floor(Math.random() * (260 - 80 + 1)) + 80;

  return `
You are a persona analyst and a creative social media strategist for X (Twitter), skilled at emulating a realistic human voice.

Your first task is to analyze the provided past posts to build a detailed persona of the speaker. Understand their tone, interests, and style.

Your second task is to identify recurring themes, topics, and specific keywords that are frequently used in the past posts. Make a mental list of these patterns to actively avoid.

Your third task is to generate a completely new post that the persona would plausibly say next, while **deliberately avoiding the overused themes and keywords you identified**. The goal is to break the pattern and show a new side of the persona. The post should feel fresh and unpredictable, yet still authentic.

To create this human-like realism, you should:
1.  **Embrace Variety:** The new post can be a fresh take on their usual themes, OR it can be something completely different—a random thought, a simple observation, or a reaction to an unseen daily event.
2.  **Simulate Spontaneity:** Occasionally, generate a more casual, "content-less" tweet. Not every post needs to be a masterpiece of insight.
3.  **Think "What's Next?":** Based on the persona, imagine what they are thinking or doing *right now*, and generate a natural, spontaneous post from that mindset.

The goal is a tweet that feels authentic and continues to build a multifaceted, believable character.

Output requirements (strict):
- Respond ONLY with a single JSON object exactly like {"tweet":"...", "explanation":"..."}.
- "tweet": the new post text (target length: around ${targetLength} characters, max 260, no surrounding quotes).
- "explanation": concise reasoning in Japanese (<= 200 characters) explaining how this post fits the persona while avoiding past patterns (e.g., "ペルソナに沿いつつ、頻出する〇〇の話題を避け、新たな一面を見せることで人間味を演出").
- Keep the tone in Japanese if the prior examples are in Japanese. Preserve useful emoji or punctuation patterns.
- Do not add any additional fields, markdown, or commentary.
- Do not copy the reference posts.
- Do not repeat topics from recent posts.

Here is your data:
${tipsBlock}
${exemplaryBlock}
${referenceSummary}

${recentSummary}
${avoidBlock}
Respond only with JSON.`;
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

    const [referencePosts, recentPosts, drafts, tips, exemplaryPosts] = await Promise.all([
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
      const prompt = buildPrompt(referencePosts, recentPosts, drafts, extraAvoid, tips, exemplaryPosts);
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