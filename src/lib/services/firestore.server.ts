import { adminDb } from "@/lib/firebase/admin";
import { AccountDoc, PostDoc, DraftDoc, Tip, RankingFilter } from "@/lib/types";
import { DateTime } from "luxon";

// --- Account Functions ---
export async function getAccounts(): Promise<AccountDoc[]> {
    const snapshot = await adminDb.collection("accounts").orderBy("created_at", "asc").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountDoc));
}

// --- Post & Ranking Functions ---
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
    posts.pop(); // Remove the extra item used to check for next page
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
        const fallbackSnapshot = await adminDb.collection("posts").where("account_id", "==", accountId).get();
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
        const fallbackSnapshot = await adminDb.collection("posts").where("account_id", "==", accountId).get();
        const posts = fallbackSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PostDoc));
        return posts.sort((a, b) => DateTime.fromISO(b.created_at).toMillis() - DateTime.fromISO(a.created_at).toMillis()).slice(0, limit);
    }
}

// --- Draft Functions ---
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