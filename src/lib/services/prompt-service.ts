import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { buildPrompt } from "@/lib/gemini/prompt";
import { generateSuggestion, generateSuggestions, type GenerationProvider } from "@/lib/ai/generation-client";
import type { GeminiSuggestion } from "@/lib/gemini/parser";
import type { AccountDoc, DraftDoc, ExemplaryPost, PostDoc, Tip, Platform } from "@/lib/types";
import { getExternalPostsForAccount, getPatternStats } from "./firestore.server";
import { extractPattern, engagementRate } from "@/lib/pattern";
import { normalizeThreadsTopicTag } from "@/lib/threads-topic-tag";
import { isPublishingEnabled } from "@/lib/account-gates";
import { markProductUsed, pickPromoProduct } from "./product-service";
import {
  belongsToCharacterVersion,
  getCharacterVersion,
} from "@/lib/character-version";

// --- Utility Functions ---
function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

// --- Data Fetching Functions ---
async function fetchTopPosts(
  accountId: string,
  limit: number,
  characterVersion: number,
  measurementWindow: "24h" | "72h",
) {
  const candidateLimit = Math.max(limit * 20, 60);
  let snapshot: FirebaseFirestore.QuerySnapshot;
  try {
    let query = adminDb
      .collection("posts")
      .where("account_id", "==", accountId) as FirebaseFirestore.Query;
    if (characterVersion > 1) {
      query = query.where("character_version", "==", characterVersion);
    }
    snapshot = await query.orderBy("created_at", "desc").limit(candidateLimit).get();
  } catch (error) {
    // Missing composite indexes must never turn prompt generation into an
    // unbounded account-wide scan. A bounded sample is less precise but safe.
    console.warn(
      `[Prompt] Recent-post query failed for ${accountId}; using a bounded sample.`,
      error,
    );
    snapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .limit(candidateLimit * 2)
      .get();
  }

  return snapshot.docs
    .map((doc) => ({ ...doc.data(), id: doc.id }) as PostDoc)
    .filter((post) => belongsToCharacterVersion(post, characterVersion))
    .flatMap((post) => {
      const checkpoint = post.performance_snapshots?.[measurementWindow];
      if (
        !checkpoint ||
        checkpoint.metrics.impressions === null ||
        checkpoint.metrics.impressions === undefined ||
        checkpoint.metrics.impressions <= 0
      ) return [];
      return [{
        ...post,
        metrics: checkpoint.metrics,
        performance_window: measurementWindow,
      }];
    })
    .sort((a, b) =>
      (b.metrics.impressions ?? -1) - (a.metrics.impressions ?? -1) ||
      (engagementRate(b.metrics) ?? -1) - (engagementRate(a.metrics) ?? -1),
    )
    .slice(0, limit);
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
    const fallbackSnapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .limit(Math.max(limit * 2, 20))
      .get();
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
    const fallbackSnapshot = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", accountId)
      .limit(Math.max(limit, 20))
      .get();
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

export async function preparePromptPayload(accountId: string, limit = 15, draftCount = 1) {
  const account = await fetchAccount(accountId);
  if (!account) {
    throw new Error("Account not found.");
  }

  const normalizedLimit = Math.min(Math.max(limit, 6), 40);
  const perCategoryLimit = Math.min(Math.max(Math.ceil(normalizedLimit / 2), 3), 20);
  const characterVersion = getCharacterVersion(account);

  const [topPosts, referencePosts, recentPosts, drafts, tips, exemplaryPosts, externalPosts, patternAnalysis] = await Promise.all([
    fetchTopPosts(
      accountId,
      3,
      characterVersion,
      account.platform === "threads" ? "72h" : "24h",
    ),
    fetchReferencePosts(accountId, 3),
    fetchRecentPosts(accountId, perCategoryLimit),
    fetchExistingDrafts(accountId, 20),
    fetchSelectedTips(account.selectedTipIds || []),
    fetchExemplaryPosts(accountId),
    getExternalPostsForAccount(account, 20),
    getPatternStats(accountId).then((analysis) =>
      analysis && getCharacterVersion(analysis) === characterVersion
        ? analysis
        : null,
    ),
  ]);

  if (recentPosts.length === 0) {
    throw new Error("No posts found for this account yet. Run a sync first.");
  }

  // Product promotion: roll once per generation. `時々` = a probability,
  // defaulting to off (0) unless the account owner enables it.
  const promoRate = Math.min(Math.max(account.promoRate ?? 0, 0), 1);
  // Preserve the per-draft chance approximately when one request produces a batch.
  const batchPromoProbability = 1 - Math.pow(1 - promoRate, Math.max(1, draftCount));
  const shouldPromo =
    account.promoEnabled === true &&
    promoRate > 0 &&
    Math.random() < batchPromoProbability;
  const promoProduct = shouldPromo ? await pickPromoProduct(accountId) : null;
  const promoDraftIndex = promoProduct
    ? Math.floor(Math.random() * Math.max(1, draftCount))
    : null;

  return {
    account,
    topPosts,
    referencePosts,
    recentPosts,
    drafts,
    tips,
    exemplaryPosts,
    externalPosts,
    patternAnalysis,
    promoProduct,
    promoDraftIndex,
    characterVersion,
  };
}



/**
 * Create up to five drafts from one model request. The live inventory and
 * character version are re-read transactionally immediately before saving.
 */
export async function generatePosts(
  accountId: string,
  platform: Platform,
  requestedCount: number,
  limit = 15,
): Promise<DraftDoc[]> {
  throw new Error("Legacy generatePosts is disabled. It bypasses the Buzz Editorial Harness;
}

export async function generatePost(accountId: string, platform: Platform, limit = 15): Promise<DraftDoc> {
  throw new Error("Legacy generatePost is disabled. It bypasses the Buzz Editorial Harness;
}
