import { DateTime } from "luxon";
import type {
  DocumentData,
  Query,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import {
  AccountDoc,
  DraftDoc,
  Platform,
  PostDoc,
  RankingFilter,
  SettingsDoc,
  Tip,
} from "@/lib/types";
import { calculateScore } from "@/lib/scoring";
import { getMonthlyUsage } from "@/lib/services/usage-service";

const DEFAULT_PROJECT_ID = "default";
type SettingsData = Omit<SettingsDoc, "id">;

function mapWithId<T>(
  doc: QueryDocumentSnapshot<DocumentData>,
): T & { id: string } {
  return { id: doc.id, ...(doc.data() as T) };
}

export async function getSettings(
  projectId: string = DEFAULT_PROJECT_ID,
): Promise<SettingsDoc | null> {
  const snapshot = await adminDb.collection("settings").doc(projectId).get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() as SettingsData | undefined;
  if (!data) {
    return null;
  }
  return { ...data, id: snapshot.id };
}

export async function getAccounts(): Promise<AccountDoc[]> {
  try {
    const snapshot = await adminDb.collection("accounts").get();
    return snapshot.docs.map((doc) => mapWithId<AccountDoc>(doc));
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      const quotaError = new Error("Firestore quota exhausted while loading accounts", {
        cause: error instanceof Error ? error : undefined,
      }) as Error & { code?: string };
      quotaError.name = "FirestoreQuotaError";
      quotaError.code = "firestore/quota-exceeded";
      throw quotaError;
    }
    throw error;
  }
}

export async function getAllTips(): Promise<Tip[]> {
  try {
    const snapshot = await adminDb.collection("tips").orderBy("created_at", "desc").get();
    return snapshot.docs.map((doc) => mapWithId<Tip>(doc));
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      const quotaError = new Error("Firestore quota exhausted while loading tips", {
        cause: error instanceof Error ? error : undefined,
      }) as Error & { code?: string };
      quotaError.name = "FirestoreQuotaError";
      quotaError.code = "firestore/quota-exceeded";
      throw quotaError;
    }
    throw error;
  }
}

export async function getDashboardSummary() {
  const accounts = await getAccounts();
  const result = await Promise.all(
    accounts.map(async (account) => {
      try {
        const snapshot = await adminDb
          .collection("posts")
          .where("account_id", "==", account.id)
          .get();

        const posts = snapshot.docs.map((doc) => mapWithId<PostDoc>(doc));
        const recentPosts = posts
          .slice()
          .sort(
            (a, b) =>
              DateTime.fromISO(b.created_at).toMillis() -
              DateTime.fromISO(a.created_at).toMillis(),
          )
          .slice(0, 50);

        const totalScore = recentPosts.reduce(
          (sum, post) => sum + (Number.isFinite(post.score) ? post.score : 0),
          0,
        );
        const postCount = posts.length;
        const averageEngagement =
          recentPosts.length > 0 ? totalScore / recentPosts.length : 0;

        const bestPost =
          posts.length > 0
            ? posts
                .slice()
                .sort((a, b) => b.score - a.score)
                .at(0) ?? null
            : null;

        return {
          account,
          stats: {
            postCount,
            averageEngagement,
            bestPost,
          },
        };
      } catch {
        return {
          account,
          stats: {
            postCount: 0,
            averageEngagement: 0,
            bestPost: null,
          },
        };
      }
    }),
  );

  return result;
}

type AccountDashboardOptions = {
  recentLimit?: number;
};

type AccountDashboardData = {
  stats: {
    postCount: number;
    bestPost: PostDoc | null;
  };
  recentPosts: PostDoc[];
};

export async function getAccountDashboardData(
  accountId: string,
  options: AccountDashboardOptions = {},
): Promise<AccountDashboardData> {
  const recentLimit = Math.max(1, options.recentLimit ?? 5);
  const baseQuery = adminDb.collection("posts").where("account_id", "==", accountId);

  let postCount = 0;
  try {
    const aggregateSnapshot = await baseQuery.count().get();
    const aggregateData = aggregateSnapshot.data();
    postCount =
      typeof aggregateData.count === "number" ? aggregateData.count : postCount;
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      const quotaError = new Error(
        `Firestore quota exhausted while counting posts for account ${accountId}`,
        { cause: error instanceof Error ? error : undefined },
      ) as Error & { code?: string };
      quotaError.name = "FirestoreQuotaError";
      quotaError.code = "firestore/quota-exceeded";
      throw quotaError;
    }
    throw error as Error;
  }

  let bestPost: PostDoc | null = null;
  if (postCount > 0) {
    try {
      const bestSnapshot = await baseQuery
        .orderBy("score", "desc")
        .orderBy("created_at", "desc")
        .limit(1)
        .get();
      const [doc] = bestSnapshot.docs;
      if (doc) {
        bestPost = mapWithId<PostDoc>(doc);
      }
    } catch (error) {
      if (isFirestoreQuotaError(error)) {
        const quotaError = new Error(
          `Firestore quota exhausted while loading best post for account ${accountId}`,
          { cause: error instanceof Error ? error : undefined },
        ) as Error & { code?: string };
        quotaError.name = "FirestoreQuotaError";
        quotaError.code = "firestore/quota-exceeded";
        throw quotaError;
      }
      const message = (error as Error).message ?? "";
      if (message.includes("requires an index")) {
        const indexError = new Error(
          "Firestore index required: posts(account_id asc, score desc, created_at desc).",
          { cause: error instanceof Error ? error : undefined },
        ) as Error & { code?: string };
        indexError.name = "FirestoreIndexError";
        indexError.code = "firestore/index-required";
        throw indexError;
      }
      throw error as Error;
    }
  }

  let recentPosts: PostDoc[] = [];
  try {
    const recentSnapshot = await baseQuery
      .orderBy("created_at", "desc")
      .limit(recentLimit)
      .get();
    recentPosts = recentSnapshot.docs.map((doc) => mapWithId<PostDoc>(doc));
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      const quotaError = new Error(
        `Firestore quota exhausted while loading recent posts for account ${accountId}`,
        { cause: error instanceof Error ? error : undefined },
      ) as Error & { code?: string };
      quotaError.name = "FirestoreQuotaError";
      quotaError.code = "firestore/quota-exceeded";
      throw quotaError;
    }
    const message = (error as Error).message ?? "";
    if (message.includes("requires an index")) {
      const indexError = new Error(
        "Firestore index required: posts(account_id asc, created_at desc).",
        { cause: error instanceof Error ? error : undefined },
      ) as Error & { code?: string };
      indexError.name = "FirestoreIndexError";
      indexError.code = "firestore/index-required";
      throw indexError;
    }
    throw error as Error;
  }

  return {
    stats: {
      postCount,
      bestPost,
    },
    recentPosts,
  };
}

type RankingOptions = {
  sort?: "top" | "latest";
  limit?: number;
  page?: number;
};

export async function getTopPosts(
  filter: RankingFilter,
  options: RankingOptions = {},
): Promise<{ posts: PostDoc[]; hasNext: boolean }> {
  let queryRef: Query<DocumentData> = adminDb.collection("posts");

  if (filter.platform !== "all") {
    queryRef = queryRef.where("platform", "==", filter.platform);
  }
  if (filter.accountId && filter.accountId !== "all") {
    queryRef = queryRef.where("account_id", "==", filter.accountId);
  }
  if (filter.media_type !== "all") {
    queryRef = queryRef.where("media_type", "==", filter.media_type);
  }

  if (filter.period_days !== "all") {
    const since = DateTime.utc().minus({ days: filter.period_days }).toISO();
    queryRef = queryRef.where("created_at", ">=", since);
  }

  const sortMode = options.sort === "latest" ? "latest" : "top";
  const limit = Math.max(1, Math.min(options.limit ?? 50, 50));
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const offset = (page - 1) * limit;

  if (sortMode === "latest") {
    queryRef = queryRef.orderBy("created_at", "desc");
  } else {
    queryRef = queryRef.orderBy("score", "desc").orderBy("created_at", "desc");
  }

  const snapshot = await queryRef.offset(offset).limit(limit + 1).get();
  const docs = snapshot.docs;
  const hasNext = docs.length > limit;
  const visibleDocs = hasNext ? docs.slice(0, limit) : docs;

  return {
    posts: visibleDocs.map((doc) => mapWithId<PostDoc>(doc)),
    hasNext,
  };
}

export async function upsertPost(post: PostDoc) {
  const ref = adminDb.collection("posts").doc(post.id);
  await ref.set(post, { merge: true });
  return ref;
}

export async function saveDraft(draft: DraftDoc) {
  const ref = adminDb.collection("drafts").doc(draft.id);
  await ref.set(draft, { merge: true });
  return ref;
}

export async function listDrafts(params?: {
  status?: DraftDoc["status"];
  platform?: Platform;
  accountId?: string;
  limit?: number;
}) {
  let queryRef: Query<DocumentData> = adminDb.collection("drafts");
  if (params?.status) {
    queryRef = queryRef.where("status", "==", params.status);
  }
  if (params?.platform) {
    queryRef = queryRef.where("target_platform", "==", params.platform);
  }
  if (params?.accountId) {
    queryRef = queryRef.where("target_account_id", "==", params.accountId);
  }

  const limitValue =
    typeof params?.limit === "number" && params.limit > 0 ? params.limit : undefined;
  if (limitValue) {
    queryRef = queryRef.limit(limitValue);
  }

  const snapshot = await queryRef.get();
  return snapshot.docs.map((doc) => mapWithId<DraftDoc>(doc));
}

export async function getDraftsByAccountId(accountId: string): Promise<DraftDoc[]> {
  const snapshot = await adminDb
    .collection("drafts")
    .where("target_account_id", "==", accountId)
    .get();
  return snapshot.docs.map((doc) => mapWithId<DraftDoc>(doc));
}

export async function updatePostScores(posts: PostDoc[]) {
  const batch = adminDb.batch();
  posts.forEach((post) => {
    const score = calculateScore({
      metrics: {
        impressions: post.metrics.impressions,
        likes: post.metrics.likes,
        replies: post.metrics.replies,
        reposts_or_rethreads: post.metrics.reposts_or_rethreads,
        link_clicks: post.metrics.link_clicks ?? 0,
      },
    });
    const ref = adminDb.collection("posts").doc(post.id);
    batch.update(ref, { score });
  });
  await batch.commit();
}

export async function getPostById(id: string) {
  const snapshot = await adminDb.collection("posts").doc(id).get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() as PostDoc | undefined;
  if (!data) {
    return null;
  }
  return { ...data, id: snapshot.id };
}

export async function getRapidApiUsage() {
  return getMonthlyUsage("rapidapi_twitter");
}

export async function getRecentPostsByAccount(
  accountId: string,
  limit = 5,
): Promise<PostDoc[]> {
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
    if (isFirestoreQuotaError(error)) {
      const quotaError = new Error(
        `Firestore quota exhausted while loading posts for account ${accountId}`,
        { cause: error instanceof Error ? error : undefined },
      ) as Error & { code?: string };
      quotaError.name = "FirestoreQuotaError";
      quotaError.code = "firestore/quota-exceeded";
      throw quotaError;
    }

    const message = (error as Error).message ?? "";
    if (!message.includes("requires an index")) {
      throw error;
    }

    try {
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
    } catch (fallbackError) {
      if (isFirestoreQuotaError(fallbackError)) {
        const quotaError = new Error(
          `Firestore quota exhausted while loading posts for account ${accountId}`,
          { cause: fallbackError instanceof Error ? fallbackError : undefined },
        ) as Error & { code?: string };
        quotaError.name = "FirestoreQuotaError";
        quotaError.code = "firestore/quota-exceeded";
        throw quotaError;
      }
      throw fallbackError;
    }
  }
}

function isFirestoreQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.toLowerCase().includes("resource_exhausted")) {
    return true;
  }

  const status = (error as { status?: unknown }).status;
  if (status === 8) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.includes("RESOURCE_EXHAUSTED")) {
    return true;
  }

  return false;
}


