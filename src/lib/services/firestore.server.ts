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
  LogDoc,
  Platform,
  PostDoc,
  RankingFilter,
  SettingsDoc,
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
  const snapshot = await adminDb.collection("accounts").get();
  return snapshot.docs.map((doc) => mapWithId<AccountDoc>(doc));
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

type RankingOptions = {
  sort?: "top" | "latest";
  limit?: number;
};

export async function getTopPosts(
  filter: RankingFilter,
  options: RankingOptions = {},
): Promise<PostDoc[]> {
  let queryRef: Query<DocumentData> = adminDb.collection("posts");

  if (filter.platform !== "all") {
    queryRef = queryRef.where("platform", "==", filter.platform);
  }
  if (filter.media_type !== "all") {
    queryRef = queryRef.where("media_type", "==", filter.media_type);
  }

  const since = DateTime.utc().minus({ days: filter.period_days }).toISO();
  queryRef = queryRef.where("created_at", ">=", since);

  const sortMode = options.sort === "latest" ? "latest" : "top";
  const limit = options.limit ?? 200;

  if (sortMode === "latest") {
    const snapshot = await queryRef.orderBy("created_at", "desc").limit(limit).get();
    return snapshot.docs.map((doc) => mapWithId<PostDoc>(doc));
  }

  const fetchLimit = Math.max(limit, 200);
  const snapshot = await queryRef.limit(fetchLimit).get();

  const posts = snapshot.docs
    .map((doc) => mapWithId<PostDoc>(doc))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const impressionsA = a.metrics.impressions ?? 0;
      const impressionsB = b.metrics.impressions ?? 0;
      return impressionsB - impressionsA;
    })
    .slice(0, limit);

  return posts;
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
}) {
  let queryRef: Query<DocumentData> = adminDb.collection("drafts");
  if (params?.status) {
    queryRef = queryRef.where("status", "==", params.status);
  }
  if (params?.platform) {
    queryRef = queryRef.where("target_platform", "==", params.platform);
  }

  const snapshot = await queryRef.get();
  return snapshot.docs.map((doc) => mapWithId<DraftDoc>(doc));
}

export async function logEvent(log: Omit<LogDoc, "id">) {
  await adminDb.collection("logs").add(log);
}

export async function updatePostScores(
  posts: PostDoc[],
  options: { impressionsProxy?: number; settings: SettingsDoc["scoring"] },
) {
  const batch = adminDb.batch();
  posts.forEach((post) => {
    const score = calculateScore(
      {
        metrics: {
          impressions: post.metrics.impressions,
          likes: post.metrics.likes,
          replies: post.metrics.replies,
          reposts_or_rethreads: post.metrics.reposts_or_rethreads,
          link_clicks: post.metrics.link_clicks ?? 0,
        },
      },
      {
        settings: options.settings,
        proxyValue: options.impressionsProxy,
      },
    );
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

