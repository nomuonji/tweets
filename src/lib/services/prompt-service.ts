import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { buildPrompt } from "@/lib/gemini/prompt";
import { requestGemini } from "@/lib/gemini/client";
import { parseGeminiResponse, type GeminiSuggestion } from "@/lib/gemini/parser";
import type { AccountDoc, DraftDoc, ExemplaryPost, PostDoc, Tip, Platform } from "@/lib/types";

// --- Utility Functions ---
function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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



export async function generatePost(accountId: string, platform: Platform, limit = 15): Promise<DraftDoc> {

  const payload = await preparePromptPayload(accountId, limit);
  const { account, topPosts, referencePosts, recentPosts, drafts, tips, exemplaryPosts } = payload;

  const normalizedDrafts = new Set(drafts.map((draft) => normalizeText(draft.text ?? "")));

  const maxAttempts = 3;
  const extraAvoid: string[] = [];
  let suggestion: GeminiSuggestion | null = null;
  let duplicate = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = buildPrompt(topPosts, referencePosts, recentPosts, drafts, extraAvoid, tips, exemplaryPosts, account.concept);
    const raw = await requestGemini(prompt);
    suggestion = parseGeminiResponse(raw);
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
