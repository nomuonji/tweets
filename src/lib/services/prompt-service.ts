import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { buildPrompt } from "@/lib/gemini/prompt";
import type { AccountDoc, DraftDoc, ExemplaryPost, PostDoc, Tip, Platform } from "@/lib/types";

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

// --- Utility Functions ---
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
  } catch {} // Ignore JSON parsing errors, try regex fallback
  const tweetMatch = cleaned.match(/"tweet"\s*:\s*"([^"]+)"/i);
  const explanationMatch = cleaned.match(/"explanation"\s*:\s*"([^"]+)"/i);
  if (tweetMatch && explanationMatch) return { tweet: tweetMatch[1], explanation: explanationMatch[1] };
  const sections = cleaned.split(/\n{2,}/);
  return { tweet: sections[0] ?? cleaned, explanation: sections.slice(1).join("\n\n") || "Failed to extract a reasoning explanation from the model response." };
}

// --- Data Fetching Functions ---
async function fetchTopPosts(accountId: string, limit: number) {
  const snapshot = await adminDb.collection("posts").where("account_id", "==", accountId).orderBy("score", "desc").limit(30).get();
  const posts = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as PostDoc[];
  for (let i = posts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [posts[i], posts[j]] = [posts[j], posts[i]];
  }
  return posts.slice(0, limit);
}

async function fetchReferencePosts(accountId: string, limit: number): Promise<Tip[]> {
    const snapshot = await adminDb.collection("tips").where("account_ids", "array-contains", accountId).get();
    const tips = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Tip[];
    for (let i = tips.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tips[i], tips[j]] = [tips[j], tips[i]];
    }
    return tips.slice(0, limit);
}

async function fetchRecentPosts(accountId: string, limit: number): Promise<PostDoc[]> {
    try {
        const snapshot = await adminDb.collection("posts").where("account_id", "==", accountId).orderBy("created_at", "desc").limit(limit).get();
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PostDoc));
    } catch (error) {
        const message = (error as Error).message ?? "";
        if (!message.includes("requires an index")) throw error;
        const fallbackSnapshot = await adminDb.collection("posts").where("account_id", "==", accountId).get();
        const posts = fallbackSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PostDoc));
        return posts.sort((a, b) => DateTime.fromISO(b.created_at).toMillis() - DateTime.fromISO(a.created_at).toMillis()).slice(0, limit);
    }
}

async function fetchExistingDrafts(accountId: string, limit: number): Promise<DraftDoc[]> {
    try {
        const snapshot = await adminDb.collection("drafts").where("target_account_id", "==", accountId).orderBy("updated_at", "desc").limit(limit).get();
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as DraftDoc));
    } catch (error) {
        const message = (error as Error).message ?? "";
        if (!message.includes("requires an index")) throw error;
        const fallbackSnapshot = await adminDb.collection("drafts").where("target_account_id", "==", accountId).get();
        const drafts = fallbackSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as DraftDoc));
        return drafts.sort((a, b) => DateTime.fromISO(b.updated_at).toMillis() - DateTime.fromISO(a.updated_at).toMillis()).slice(0, limit);
    }
}

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

// --- Core Service Functions ---

export async function preparePromptPayload(accountId: string, limit = 15) {
    const account = await fetchAccount(accountId);
    if (!account) {
        throw new Error("Account not found.");
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
      throw new Error("No posts found for this account yet. Run a sync first.");
    }

    return {
        account,
        topPosts,
        referencePosts,
        recentPosts,
        drafts,
        tips,
        exemplaryPosts,
    };
}

async function requestGemini(prompt: string, apiKey: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: GENERATION_CONFIG }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `Gemini API request failed with status ${response.status}`);
  return data;
}

export async function generatePost(accountId: string, platform: Platform, limit = 15): Promise<DraftDoc> {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not configured.");

    const payload = await preparePromptPayload(accountId, limit);
    const { account, topPosts, referencePosts, recentPosts, drafts, tips, exemplaryPosts } = payload;

    const normalizedDrafts = new Set(drafts.map((draft) => normalizeText(draft.text ?? "")));

    const maxAttempts = 3;
    const extraAvoid: string[] = [];
    let suggestion: GeminiSuggestion | null = null;
    let duplicate = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const prompt = buildPrompt(topPosts, referencePosts, recentPosts, drafts, extraAvoid, tips, exemplaryPosts, account.concept);
      const raw = await requestGemini(prompt, geminiApiKey);
      suggestion = parseSuggestion(raw);
      const normalizedSuggestion = normalizeText(suggestion.tweet);
      duplicate = normalizedDrafts.has(normalizedSuggestion);
      if (!duplicate) break;
      extraAvoid.push(suggestion.tweet);
    }

    if (!suggestion) throw new Error("Failed to generate a unique suggestion.");

    const now = DateTime.utc().toISO()!;
    const draftId = `gemini_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const newDraft: DraftDoc = {
      id: draftId,
      target_platform: platform,
      target_account_id: accountId,
      text: suggestion.tweet,
      hashtags: [],
      status: "scheduled",
      schedule_time: null,
      published_at: null,
      created_by: "gemini-auto",
      created_at: now,
      updated_at: now,
      similarity_warning: duplicate,
    };

    await adminDb.collection("drafts").doc(draftId).set(newDraft);
    return newDraft;
}
