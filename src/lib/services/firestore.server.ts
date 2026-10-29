import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import {
  AccountDoc,
  PostDoc,
  DraftDoc,
  Tip,
  RankingFilter,
  ExternalPostDoc,
  ReferenceAccountDoc,
  PatternAnalysis,
} from "@/lib/types";
import { DateTime } from "luxon";
import { belongsToCharacterVersion } from "@/lib/character-version";

// --- Account Functions ---
export async function getAccounts(): Promise<AccountDoc[]> {
    const snapshot = await adminDb.collection("accounts").orderBy("created_at", "asc").get();
    return snapshot.docs.map(doc => {
        const data = { ...(doc.data() ?? {}) };
        delete data.promoReplyRate; // Legacy, ignored reply lottery setting.
        return { id: doc.id, ...data } as AccountDoc;
    });
}

export async function getAccount(id: string): Promise<AccountDoc | null> {
    const doc = await adminDb.collection("accounts").doc(id).get();
    if (!doc.exists) {
        return null;
    }
    const data = { ...(doc.data() ?? {}) };
    delete data.promoReplyRate; // Never expose an inert probability setting.
    return { id: doc.id, ...data } as AccountDoc;
}

// --- Post & Ranking Functions ---
export async function upsertPost(post: PostDoc): Promise<void> {
    await adminDb.collection("posts").doc(post.id).set(post, { merge: true });
}

export async function getTopPosts(
  filter: RankingFilter,
  options: { sort: "top" | "latest"; limit: number; page: number },
): Promise<{ posts: PostDoc[]; hasNext: boolean }> {
  let query = adminDb.collection("posts") as FirebaseFirestore.Query;

  if (filter.platform !== "all") {
    query = query.where("platform", "==", filter.platform);
  }
  if (filter.media_type !== "all") {
    query = query.where("media_type", "==", filter.media_type);
  }
  if (filter.accountId && filter.accountId !== "all") {
    query = query.where("account_id", "==", filter.accountId);
  }
  if (filter.period_days !== "all") {
    const startDate = DateTime.now().minus({ days: filter.period_days }).toISO();
    if (startDate) {
      query = query.where("created_at", ">=", startDate);
    }
  }

  const orderByField = options.sort === "latest" ? "created_at" : "score";
  query = query.orderBy(orderByField, "desc");

  const limit = options.limit > 0 ? options.limit : 50;
  const page = options.page > 0 ? options.page : 1;

  if (page > 1) {
    const startAfterSnapshot = await query.limit((page - 1) * limit).get();
    const lastVisible = startAfterSnapshot.docs[startAfterSnapshot.docs.length - 1];
    if (lastVisible) {
      query = query.startAfter(lastVisible);
    }
  }

  const snapshot = await query.limit(limit + 1).get();
  const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PostDoc));

  const hasNext = posts.length > limit;
  if (hasNext) {
    posts.pop();
  }

  return { posts, hasNext };
}

export async function fetchTopPosts(accountId: string, limit: number): Promise<PostDoc[]> {
    try {
        const snapshot = await adminDb.collection("posts").where("account_id", "==", accountId).orderBy("score", "desc").limit(limit).get();
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PostDoc));
    } catch (error) {
        const message = (error as Error).message ?? "";
        if (!message.includes("requires an index")) throw error;
        const fallbackSnapshot = await adminDb
          .collection("posts")
          .where("account_id", "==", accountId)
          .limit(Math.max(limit * 3, 30))
          .get();
        const posts = fallbackSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PostDoc));
        return posts.sort((a, b) => b.score - a.score).slice(0, limit);
    }
}

export async function fetchRecentPosts(accountId: string, limit: number): Promise<PostDoc[]> {
    try {
        const snapshot = await adminDb.collection("posts").where("account_id", "==", accountId).orderBy("created_at", "desc").limit(limit).get();
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PostDoc));
    } catch (error) {
        const message = (error as Error).message ?? "";
        if (!message.includes("requires an index")) throw error;
        const fallbackSnapshot = await adminDb
          .collection("posts")
          .where("account_id", "==", accountId)
          .limit(Math.max(limit * 3, 20))
          .get();
        const posts = fallbackSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PostDoc));
        return posts.sort((a, b) => DateTime.fromISO(b.created_at).toMillis() - DateTime.fromISO(a.created_at).toMillis()).slice(0, limit);
    }
}

// --- External discovery ---
export async function getReferenceAccounts(
  accountIds: string[] = [],
): Promise<ReferenceAccountDoc[]> {
  if (accountIds.length === 0) return [];
  const snapshot = await adminDb
    .collection("reference_accounts")
    .where("status", "==", "approved")
    .get();
  const allowed = new Set(accountIds);
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ReferenceAccountDoc)
    .filter((account) => allowed.has(account.id));
}

export async function saveReferenceAccount(
  account: ReferenceAccountDoc,
): Promise<void> {
  await adminDb.collection("reference_accounts").doc(account.id).set(account, {
    merge: true,
  });
}

export async function getExternalPostsForAccount(
  account: AccountDoc,
  limit = 20,
): Promise<ExternalPostDoc[]> {
  const keywords = account.discoveryKeywords ?? [];
  const referenceAccountIds = account.referenceAccountIds ?? [];
  if (keywords.length === 0 && referenceAccountIds.length === 0) return [];

  const chunk = <T,>(values: T[], size: number) =>
    Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
      values.slice(index * size, (index + 1) * size),
    );
  const queryLimit = Math.max(limit * 3, 30);
  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  for (const group of chunk(keywords, 10)) {
    queries.push(
      adminDb
        .collection("external_posts")
        .where("search_keyword", "in", group)
        .limit(queryLimit)
        .get(),
    );
  }
  for (const group of chunk(referenceAccountIds, 10)) {
    queries.push(
      adminDb
        .collection("external_posts")
        .where("source_account_id", "in", group)
        .limit(queryLimit)
        .get(),
    );
  }

  const snapshots = await Promise.all(queries);
  const unique = new Map<string, ExternalPostDoc>();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      unique.set(doc.id, { id: doc.id, ...doc.data() } as ExternalPostDoc);
    }
  }

  return Array.from(unique.values())
    .sort((a, b) => {
      const scoreA = a.engagement_rate ?? 0;
      const scoreB = b.engagement_rate ?? 0;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

export async function upsertExternalPost(post: ExternalPostDoc): Promise<void> {
  await adminDb.collection("external_posts").doc(post.id).set(post, {
    merge: true,
  });
}

export async function getPatternStats(
  accountId: string,
): Promise<PatternAnalysis | null> {
  const doc = await adminDb.collection("pattern_stats").doc(accountId).get();
  if (!doc.exists) return null;
  return doc.data() as PatternAnalysis;
}

export async function savePatternStats(
  accountId: string,
  analysis: PatternAnalysis,
): Promise<void> {
  await adminDb
    .collection("pattern_stats")
    .doc(accountId)
    .set({ ...analysis, account_id: accountId }, { merge: true });
}

// --- Draft Functions ---
export async function saveDraft(draft: Omit<DraftDoc, 'id'> & { id?: string }): Promise<DraftDoc> {
    const docRef = draft.id ? adminDb.collection("drafts").doc(draft.id) : adminDb.collection("drafts").doc();
    const finalDraft = { ...draft, id: docRef.id };
    await docRef.set(finalDraft, { merge: true });
    return finalDraft;
}

export async function getDraftsByAccountId(accountId: string): Promise<DraftDoc[]> {
    const snapshot = await adminDb.collection("drafts").where("target_account_id", "==", accountId).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DraftDoc));
}

export async function getUsableDraftsByAccountId(
  accountId: string,
  characterVersion: number,
  limit = 5,
): Promise<DraftDoc[]> {
  const boundedLimit = Math.max(1, limit);
  // Do not limit before filtering by character version. Old drafts can occupy
  // the first N documents for either status, which made generation work report
  // fewer usable drafts than the write transaction (which correctly scans the
  // full account queue) and caused false replenishment attempts.
  const snapshot = await adminDb
    .collection("drafts")
    .where("target_account_id", "==", accountId)
    .get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DraftDoc)
    .filter((draft) => draft.status === "scheduled" || draft.status === "draft")
    .filter((draft) => belongsToCharacterVersion(draft, characterVersion))
    .slice(0, boundedLimit);
}

/**
 * Open-draft inventory for every account in one query.
 *
 * `getUsableDraftsByAccountId` scans an account's whole draft queue, so calling
 * it once per account turned a dashboard read into N queries. A single
 * status-filtered scan is enough because the queue is small by design
 * (publishing deletes drafts) and needs no composite index.
 */
export async function getOpenDraftInventory(): Promise<
  Map<string, DraftDoc[]>
> {
  const snapshot = await adminDb
    .collection("drafts")
    .where("status", "in", ["draft", "scheduled"])
    .get();
  const byAccount = new Map<string, DraftDoc[]>();
  for (const doc of snapshot.docs) {
    const draft = { id: doc.id, ...doc.data() } as DraftDoc;
    const accountId = draft.target_account_id;
    if (!accountId) continue;
    const list = byAccount.get(accountId) ?? [];
    list.push(draft);
    byAccount.set(accountId, list);
  }
  return byAccount;
}

function discoveryStateId(accountId: string, key: string): string {
  return `${accountId}__${createHash("sha1").update(key).digest("hex")}`;
}

/**
 * Last fetch time per discovery source.
 *
 * Freshness used to be derived by scanning up to 900 stored posts per account
 * on every run, just to find the newest `fetched_at`. One small doc per source
 * answers the same question with one read.
 */
export async function getDiscoveryState(
  accountId: string,
  keys: string[],
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const refs = keys.map((key) =>
    adminDb.collection("external_discovery_state").doc(discoveryStateId(accountId, key)),
  );
  const snapshots = await adminDb.getAll(...refs);
  const result: Record<string, string> = {};
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const fetchedAt = snapshot.get("last_fetched_at");
    if (typeof fetchedAt === "string" && fetchedAt) {
      result[keys[index]] = fetchedAt;
    }
  });
  return result;
}

export async function saveDiscoveryState(
  accountId: string,
  key: string,
  fetchedAt: string,
): Promise<void> {
  await adminDb
    .collection("external_discovery_state")
    .doc(discoveryStateId(accountId, key))
    .set(
      {
        account_id: accountId,
        source_key: key,
        last_fetched_at: fetchedAt,
        updated_at: fetchedAt,
      },
      { merge: true },
    );
}

export async function listDrafts(accountId?: string): Promise<DraftDoc[]> {
    let query = adminDb.collection("drafts").orderBy("updated_at", "desc");
    if (accountId) {
        query = query.where("target_account_id", "==", accountId);
    }
    const snapshot = await query.limit(50).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DraftDoc));
}

// --- Tip Functions ---
export async function getAllTips(): Promise<Tip[]> {
    const snapshot = await adminDb.collection("tips").orderBy("created_at", "desc").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tip));
}

// --- Usage Functions ---
export async function getRapidApiUsage(): Promise<{ month: string, count: number }> {
    const now = DateTime.local();
    const month = now.toFormat("yyyy-MM");
    const snapshot = await adminDb.collection('usage').doc(month).get();
    if (!snapshot.exists) {
        return { month, count: 0 };
    }
    return { month, count: snapshot.data()?.count || 0 };
}

// --- Dashboard Specific Functions ---
export async function getAccountDashboardData(accountId: string) {
    const [recentPosts, topPosts] = await Promise.all([
        fetchRecentPosts(accountId, 5),
        getTopPosts({ accountId, platform: 'all', media_type: 'all', period_days: 'all' }, { sort: 'top', limit: 1, page: 1 }),
    ]);

    const postCountSnap = await adminDb.collection("posts").where("account_id", "==", accountId).count().get();

    return {
        stats: {
            postCount: postCountSnap.data().count,
            bestPost: topPosts.posts[0] || null,
        },
        recentPosts,
    };
}
