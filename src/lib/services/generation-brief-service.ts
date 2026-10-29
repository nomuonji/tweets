import { adminDb } from "@/lib/firebase/admin";
import { getCharacterVersion, belongsToCharacterVersion } from "@/lib/character-version";
import { extractPattern } from "@/lib/pattern";
import type {
  AccountDoc,
  DraftDoc,
  ExemplaryPost,
  ExternalPostDoc,
  PatternAnalysis,
  PostDoc,
  Tip,
} from "@/lib/types";
import {
  getAccount,
  getExternalPostsForAccount,
  getPatternStats,
} from "./firestore.server";

const RECENT_POST_LIMIT = 20;
const OPEN_DRAFT_LIMIT = 20;
const EXTERNAL_LIMIT = 24;

/**
 * One call's worth of context for an external agent.
 *
 * The point is to stop generating a single post from a single prompt. An agent
 * that can hold this brief can plan a batch: pick distinct 型, spread distinct
 * ネタ, and avoid re-using an opening — none of which one isolated generation
 * call can do, because it cannot see its own previous output.
 */
export type GenerationBrief = {
  accountId: string;
  handle: string;
  platform: string;
  characterVersion: number;
  concept: string;
  length: { min: number | null; max: number | null };
  schedule: string[];
  inventory: {
    usableDrafts: number;
    neededCount: number;
    requested: number;
    draftsMissingStructure: number;
  };
  /** 型 catalogue: selected tips plus tips linked to this account. */
  tips: Array<{ id: string; title: string; text: string }>;
  /** Style samples. The strongest reproduction lever per docs/reference-style-policy.md. */
  exemplary: Array<{ id: string; text: string; explanation: string }>;
  /** ネタ / 型 supply from other accounts, ranked by follower-relative reach. */
  external: Array<{
    id: string;
    author: string;
    followers: number | null;
    likes: number;
    reposts: number;
    impressions: number | null;
    /** likes / followers — the "unknown account went viral" signal. */
    likeRatio: number | null;
    structure: string;
    text: string;
    url: string | null;
  }>;
  /** Own-account structure performance. */
  patterns: Array<{ structure: string; count: number; medianEngagementRate: number }>;
  avoid: { recentPosts: string[]; openDrafts: string[] };
  rules: string[];
};

function tipIdsOf(account: AccountDoc): string[] {
  return account.selectedTipIds ?? [];
}

async function fetchTips(account: AccountDoc): Promise<Tip[]> {
  const byId = new Map<string, Tip>();
  const selected = tipIdsOf(account);
  if (selected.length > 0) {
    const snapshot = await adminDb
      .collection("tips")
      .where("__name__", "in", selected.slice(0, 10))
      .get();
    for (const doc of snapshot.docs) {
      byId.set(doc.id, { id: doc.id, ...doc.data() } as Tip);
    }
  }
  // Tips can also be attached by account_ids (the UI path writes selectedTipIds,
  // but older records use the array), so read both.
  const linked = await adminDb
    .collection("tips")
    .where("account_ids", "array-contains", account.id)
    .get();
  for (const doc of linked.docs) {
    byId.set(doc.id, { id: doc.id, ...doc.data() } as Tip);
  }
  return Array.from(byId.values());
}

async function fetchExemplary(accountId: string): Promise<ExemplaryPost[]> {
  const snapshot = await adminDb
    .collection("accounts")
    .doc(accountId)
    .collection("exemplary_posts")
    .orderBy("created_at", "desc")
    .limit(10)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ExemplaryPost);
}

async function fetchRecentPosts(accountId: string): Promise<PostDoc[]> {
  const snapshot = await adminDb
    .collection("posts")
    .where("account_id", "==", accountId)
    .limit(RECENT_POST_LIMIT * 3)
    .get();
  const posts = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as PostDoc);
  return posts
    .sort(
      (a, b) =>
        Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""),
    )
    .slice(0, RECENT_POST_LIMIT);
}

async function fetchOpenDrafts(accountId: string): Promise<DraftDoc[]> {
  // Bounded scan: the queue stays small because publishing deletes drafts, and
  // one read here serves both the inventory count and the avoid list.
  const snapshot = await adminDb
    .collection("drafts")
    .where("target_account_id", "==", accountId)
    .limit(OPEN_DRAFT_LIMIT * 5)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DraftDoc)
    .filter((draft) => draft.status === "draft" || draft.status === "scheduled")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

/**
 * Rank external posts by follower-relative reach. Raw likes reward big
 * accounts, so a post from a 176-follower account that got 12k likes has to
 * outrank a 90k-like post from a 90k-follower account.
 */
function rankExternal(posts: ExternalPostDoc[]) {
  return posts
    .map((post) => {
      const followers = post.author_followers ?? null;
      const likes = post.metrics?.likes ?? 0;
      return {
        post,
        followers,
        likes,
        likeRatio: followers && followers > 0 ? likes / followers : null,
      };
    })
    .sort((a, b) => {
      const ar = a.likeRatio ?? -1;
      const br = b.likeRatio ?? -1;
      if (br !== ar) return br - ar;
      return b.likes - a.likes;
    });
}

export async function buildGenerationBrief(
  accountId: string,
  requested?: number,
): Promise<GenerationBrief> {
  const account = await getAccount(accountId);
  if (!account) throw new Error("Account not found.");
  const characterVersion = getCharacterVersion(account);

  const [externalPosts, patternStats, tips, exemplary, recentPosts, openDrafts] =
    await Promise.all([
      getExternalPostsForAccount(account, EXTERNAL_LIMIT),
      getPatternStats(accountId).catch(() => null) as Promise<PatternAnalysis | null>,
      fetchTips(account),
      fetchExemplary(accountId),
      fetchRecentPosts(accountId),
      fetchOpenDrafts(accountId),
    ]);

  // One drafts read serves both the inventory count and the avoid list.
  const usable = openDrafts.filter((draft) =>
    belongsToCharacterVersion(draft, characterVersion),
  );
  const neededCount = Math.max(0, 5 - usable.length);
  const count = Math.min(Math.max(requested ?? neededCount, 1), 10);

  const patterns = (patternStats?.patterns ?? [])
    .slice(0, 8)
    .map((stat) => ({
      structure: stat.structure,
      count: stat.count,
      medianEngagementRate: stat.medianEngagementRate,
    }));

  const external = rankExternal(externalPosts)
    .slice(0, EXTERNAL_LIMIT)
    .map(({ post, followers, likes, likeRatio }) => ({
      id: post.id,
      author: post.author_handle ?? "unknown",
      followers,
      likes,
      reposts: post.metrics?.reposts_or_rethreads ?? 0,
      impressions: post.metrics?.impressions ?? null,
      likeRatio,
      structure: post.pattern?.structure ?? extractPattern(post.text).structure,
      text: post.text,
      url: post.url ?? null,
    }));

  const rules = [
    `Write exactly ${count} drafts. Submit them in one create_drafts call.`,
    "Decide the 型 (structure) for each draft first, and make every draft use a different 型.",
    "Every draft needs a different opening line. Never start two drafts the same way.",
    "One claim per draft. Do not merge two ideas into one post.",
    "Use external posts as ネタ (subject matter) and 型 (structure) supply only. Do not copy their wording.",
    "Prefer external posts with a high likeRatio: those are cases where the text, not the follower count, did the work.",
    `Length: ${account.minPostLength ?? "no minimum"}–${account.maxPostLength ?? "platform limit"} characters.`,
    "Attach provenance to each draft: tipIds you followed, externalPostIds you drew on, and a one-line rationale.",
    "Set provenance.structure to the 型 you chose. pattern.structure is a regex guess and collapses distinct 型 into the same bucket, so analysis relies on your label.",
    "Do not repeat the content or phrasing of recentPosts / openDrafts.",
  ];

  return {
    accountId,
    handle: account.handle,
    platform: account.platform,
    characterVersion,
    concept: account.concept ?? "",
    length: {
      min: account.minPostLength ?? null,
      max: account.maxPostLength ?? null,
    },
    schedule: account.postSchedule ?? [],
    inventory: {
      usableDrafts: usable.length,
      neededCount,
      requested: count,
      /** Usable drafts whose 型 was never recorded, so they cannot be analysed. */
      draftsMissingStructure: usable.filter((draft) => !draft.provenance?.structure)
        .length,
    },
    tips: tips.map((tip) => ({ id: tip.id, title: tip.title, text: tip.text })),
    exemplary: exemplary.map((post) => ({
      id: post.id,
      text: post.text,
      explanation: post.explanation,
    })),
    external,
    patterns,
    avoid: {
      recentPosts: recentPosts.map((post) => post.text.replace(/\s+/g, " ").slice(0, 160)),
      openDrafts: openDrafts.map((draft) => draft.text.replace(/\s+/g, " ").slice(0, 160)),
    },
    rules,
  };
}
