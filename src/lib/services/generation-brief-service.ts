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
  /** Stratified outside examples; the agent must verify relevance before use. */
  external: Array<{
    id: string;
    author: string;
    followers: number | null;
    likes: number;
    replies: number;
    reposts: number;
    impressions: number | null;
    /** likes / followers; NOT an impression-normalized engagement rate. */
    likeRatio: number | null;
    /** impressions / followers; a rough signal, not proof of causation. */
    exposurePerFollower: number | null;
    searchKeyword: string | null;
    discoveryMode: "Top" | "Latest" | null;
    sampleLane: "higher-exposure-per-follower" | "higher-likes-per-follower" | "lower-exposure-per-follower" | "typical-exposure-per-follower" | "recent-contrast";
    createdAt: string;
    structure: string;
    text: string;
    url: string | null;
  }>;
  /** Own-account structure performance from comparable-age observations. */
  measurementWindow: "24h" | "48h" | "72h" | null;
  measurementBasis: "fixed_age_snapshot" | "fetched_at_age_matched" | "mixed_exact_snapshot_and_fetched_at" | null;
  cohortAgeHours: { min: number; max: number } | null;
  exposureMetric: "views" | "impressions" | null;
  patterns: Array<{
    structure: string;
    count: number;
    medianImpressions: number;
    medianEngagementRate: number;
  }>;
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
 * Keep five observation lanes instead of treating likes/follower as a reach
 * metric. "recent-contrast" is a temporal sample, not a low-performing control.
 */
function sampleExternal(posts: ExternalPostDoc[], limit: number) {
  const rows = posts.map((post) => {
    const followers = post.author_followers ?? null;
    const likes = post.metrics?.likes ?? 0;
    const impressions = post.metrics?.impressions ?? null;
    return {
      post,
      followers,
      likes,
      likeRatio: followers && followers > 0 ? likes / followers : null,
      exposurePerFollower:
        followers && followers > 0 && impressions !== null && impressions > 0
          ? impressions / followers
          : null,
    };
  });
  const selected = new Map<string, (typeof rows)[number] & {
    sampleLane: "higher-exposure-per-follower" | "higher-likes-per-follower" | "lower-exposure-per-follower" | "typical-exposure-per-follower" | "recent-contrast";
  }>();
  const addLane = (candidates: typeof rows, lane: "higher-exposure-per-follower" | "higher-likes-per-follower" | "lower-exposure-per-follower" | "typical-exposure-per-follower" | "recent-contrast", quota: number) => {
    let added = 0;
    for (const row of candidates) {
      if (selected.has(row.post.id)) continue;
      selected.set(row.post.id, { ...row, sampleLane: lane });
      added += 1;
      if (added >= quota || selected.size >= limit) break;
    }
  };
  const comparableExposure = rows.filter((row) => row.exposurePerFollower !== null);
  const perLane = Math.max(1, Math.ceil(limit / 5));
  addLane(
    [...comparableExposure].sort((x, y) => (y.exposurePerFollower ?? -1) - (x.exposurePerFollower ?? -1)),
    "higher-exposure-per-follower",
    perLane,
  );
  addLane(
    rows.filter((row) => row.likeRatio !== null).sort((x, y) => (y.likeRatio ?? -1) - (x.likeRatio ?? -1)),
    "higher-likes-per-follower",
    perLane,
  );
  addLane(
    [...comparableExposure].sort((x, y) => (x.exposurePerFollower ?? Infinity) - (y.exposurePerFollower ?? Infinity)),
    "lower-exposure-per-follower",
    perLane,
  );
  if (comparableExposure.length > 0) {
    const values = comparableExposure.map((row) => row.exposurePerFollower as number).sort((x, y) => x - y);
    const middle = Math.floor(values.length / 2);
    const medianExposure = values.length % 2
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2;
    addLane(
      [...comparableExposure].sort((x, y) =>
        Math.abs((x.exposurePerFollower ?? 0) - medianExposure) -
        Math.abs((y.exposurePerFollower ?? 0) - medianExposure),
      ),
      "typical-exposure-per-follower",
      perLane,
    );
  }
  addLane(
    [...rows].sort((x, y) => Date.parse(y.post.created_at) - Date.parse(x.post.created_at)),
    "recent-contrast",
    limit,
  );
  return Array.from(selected.values()).slice(0, limit);
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

  const measuredPatternStats =
    getCharacterVersion(patternStats ?? {}) === characterVersion &&
    (
      patternStats?.measurementWindow === "24h" ||
      patternStats?.measurementWindow === "48h" ||
      patternStats?.measurementWindow === "72h"
    )
      ? patternStats
      : null;
  const patterns = [...(measuredPatternStats?.patterns ?? [])]
    .filter(
      (stat) =>
        typeof stat.medianImpressions === "number" &&
        Number.isFinite(stat.medianImpressions),
    )
    .sort(
      (a, b) =>
        (b.medianImpressions ?? -1) - (a.medianImpressions ?? -1),
    )
    .slice(0, 8)
    .map((stat) => ({
      structure: stat.structure,
      count: stat.count,
      medianImpressions: stat.medianImpressions as number,
      medianEngagementRate: stat.medianEngagementRate,
    }));

  const external = sampleExternal(externalPosts, EXTERNAL_LIMIT)
    .map(({ post, followers, likes, likeRatio, exposurePerFollower, sampleLane }) => ({
      id: post.id,
      author: post.author_handle ?? "unknown",
      followers,
      likes,
      replies: post.metrics?.replies ?? 0,
      reposts: post.metrics?.reposts_or_rethreads ?? 0,
      impressions: post.metrics?.impressions ?? null,
      likeRatio,
      exposurePerFollower,
      searchKeyword: post.search_keyword ?? null,
      discoveryMode: post.discovery_mode ?? null,
      sampleLane,
      createdAt: post.created_at,
      structure: post.pattern?.structure ?? extractPattern(post.text).structure,
      text: post.text,
      url: post.url ?? null,
    }));

  const rules = [
    `Write exactly ${count} drafts. Submit them in one create_drafts call.`,
    "Decide the 型 (structure) for each draft first, and make every draft use a different 型.",
    "Every draft needs a different opening line. Never start two drafts the same way.",
    "One claim per draft. Do not merge two ideas into one post.",
    "Before using an external post, compare its actual text with this account’s character sheet, intended reader and subject. Reject off-topic results even when metrics are high; searchKeyword is retrieval provenance, not proof of relevance.",
    "External metrics differ: likeRatio means likes/followers; exposurePerFollower means impressions/followers. Neither proves causation or audience fit.",
    "Use higher-exposure and higher-like samples as hypotheses. Use recent-contrast to inspect topics and structures beyond high-ranked posts; it is NOT a low-performing control group.",
    "Use external posts as subject or structure inspiration only. Do not copy wording, claims, persona or emotional stance.",
    ...(account.platform === "threads" ? ["For each Threads draft, set one topicTag without # only when the post has a clear topic match. Omit weak fits. Use 1–50 characters and avoid periods and ampersands."] : ["Do not set topicTag for X drafts."]),
    "Run a final content-quality check before saving. The agent may create drafts only; it must never publish them.",
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
    measurementWindow: measuredPatternStats?.measurementWindow ?? null,
    measurementBasis: measuredPatternStats?.measurementBasis ?? null,
    cohortAgeHours: measuredPatternStats?.cohortAgeHours ?? null,
    exposureMetric: measuredPatternStats?.exposureMetric ?? null,
    patterns,
    avoid: {
      recentPosts: recentPosts.map((post) => post.text.replace(/\s+/g, " ").slice(0, 160)),
      openDrafts: openDrafts.map((draft) => draft.text.replace(/\s+/g, " ").slice(0, 160)),
    },
    rules,
  };
}
