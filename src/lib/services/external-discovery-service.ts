import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { AccountDoc, ExternalPostDoc, ExternalPostObservationDoc, ReferenceAccountDoc } from "@/lib/types";
import { adminDb } from "@/lib/firebase/admin";
import { engagementRate, extractPattern } from "@/lib/pattern";
import { fetchRecentXPosts, fetchXSearchPosts } from "@/lib/platforms/x";
import {
  getDiscoveryState,
  getReferenceAccounts,
  saveDiscoveryState,
  upsertExternalPost,
} from "./firestore.server";
import { getRapidApiBudgetState, type RapidApiBudgetState } from "./usage-service";

const POSTS_PER_SOURCE = 20;
/** Discovery is about reusable text structure, so media-only posts are useless. */
const TEXT_ONLY = true;

/**
 * How long a keyword/reference result is reused before another paid request.
 * Default 48h. This is the conservative shared-budget cadence.
 */
function cacheHours(): number {
  const parsed = Number(process.env.DISCOVERY_CACHE_HOURS ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 48;
}

/**
 * How many of an account's saved sources may be paid for in one run.
 * Stored keywords/references are kept and rotated instead of deleted.
 */
function maxSourcesPerRun(): number {
  const parsed = Number(process.env.DISCOVERY_MAX_SOURCES_PER_ACCOUNT ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

/**
 * Rotate deterministically so a capped run still walks through the whole keyword
 * list over time, without storing rotation state.
 *
 * The bucket is the cache window, not a fixed week: if rotation were slower than
 * the cache, the same few keywords would be re-fetched every window while the
 * rest never ran.
 */
function pickRotating<T>(items: T[], count: number, now: DateTime): T[] {
  if (count <= 0 || items.length <= count) return items;
  const windowMs = cacheHours() * 60 * 60 * 1000;
  const bucket = Math.floor(now.toMillis() / windowMs);
  const start = bucket % items.length;
  return Array.from({ length: count }, (_, i) => items[(start + i) % items.length]);
}

/**
 * Author block for an external post. `search.php` returns `user_info`, while
 * `timeline.php` returns `author`. Reading only `author` silently produced
 * "unknown" handles and null follower counts for every keyword-sourced post.
 */
function authorRecord(
  post: { raw?: Record<string, unknown> },
): Record<string, unknown> | null {
  const raw = post.raw ?? {};
  for (const key of ["user_info", "author", "user"]) {
    const value = raw[key];
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function authorHandle(post: { raw?: Record<string, unknown> }): string {
  const handle =
    authorRecord(post)?.screen_name ?? (post.raw ?? {}).screen_name;
  if (typeof handle === "string" && handle.trim()) return handle;
  return "unknown";
}

/**
 * Follower count when the source exposes it. Kept so follower-relative reach is
 * measurable instead of relying on raw like counts, which favour big accounts.
 */
function authorFollowers(post: { raw?: Record<string, unknown> }): number | null {
  const value = authorRecord(post)?.followers_count;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toExternalPost(
  post: {
    platform_post_id: string;
    text: string;
    created_at: string;
    url?: string;
    metrics: ExternalPostDoc["metrics"];
    raw?: Record<string, unknown>;
  },
  now: string,
  source: {
    keyword?: string;
    accountId?: string;
    discoveryMode?: "Top" | "Latest";
    discoveryOrigin: "account_keyword" | "reference_account";
    discoveryQueryId: string;
  },
): ExternalPostDoc {
  // Firestore rejects `undefined`, and only one of keyword/accountId is ever
  // set. Writing both unconditionally made every keyword-sourced upsert throw,
  // so discovery spent API calls and stored nothing.
  const external = {
    id: `x_external_${post.platform_post_id}`,
    platform: "x" as const,
    platform_post_id: post.platform_post_id,
    author_handle: authorHandle(post),
    author_followers: authorFollowers(post),
    text: post.text,
    created_at: post.created_at,
    metrics: post.metrics,
    ...(post.url ? { url: post.url } : {}),
    ...(source.keyword ? { search_keyword: source.keyword } : {}),
    ...(source.accountId ? { source_account_id: source.accountId } : {}),
    ...(source.discoveryMode ? { discovery_mode: source.discoveryMode } : {}),
    discovery_origin: source.discoveryOrigin,
    discovery_query_id: source.discoveryQueryId,
    fetched_at: now,
  } satisfies ExternalPostDoc;
  return {
    ...external,
    engagement_rate: engagementRate(external.metrics),
    pattern: extractPattern(post.text),
  };
}


const COLLECTOR_VERSION = "external-discovery-v2";

function buildExternalObservationId(
  runId: string,
  targetAccountId: string,
  queryId: string,
  postId: string,
  mode: "Top" | "Latest" | "timeline",
): string {
  const digest = createHash("sha256")
    .update(`${runId}\\n${targetAccountId}\\n${queryId}\\n${postId}\\n${mode}`)
    .digest("hex")
    .slice(0, 40);
  return `externalobs_${digest}`;
}

async function appendExternalObservation(
  post: ExternalPostDoc,
  source: {
    targetAccountId: string;
    keyword?: string;
    accountId?: string;
    discoveryMode?: "Top" | "Latest";
    discoveryOrigin: "account_keyword" | "reference_account";
    discoveryQueryId: string;
  },
  runId: string,
  fetchedAt: string,
): Promise<void> {
  const author = post.author_handle?.trim() || "unknown";
  const receipt: ExternalPostObservationDoc = {
    id: buildExternalObservationId(
      runId,
      source.targetAccountId,
      source.discoveryQueryId,
      post.platform_post_id,
      source.discoveryMode ?? "timeline",
    ),
    external_post_id: post.id,
    platform: "x",
    platform_post_id: post.platform_post_id,
    author_handle: author,
    canonical_url: post.url ?? `https://x.com/i/web/status/${post.platform_post_id}`,
    text_hash: createHash("sha256").update(post.text).digest("hex"),
    created_at: post.created_at,
    fetched_at: fetchedAt,
    search_keyword: source.keyword ?? `reference account: ${source.accountId ?? "unknown"}`,
    discovery_query_id: source.discoveryQueryId,
    discovery_origin: source.discoveryOrigin,
    discovery_mode: source.discoveryMode ?? "timeline",
    source_type: source.discoveryOrigin === "account_keyword"
      ? "account_keyword_query"
      : "reference_account_timeline",
    target_account_id: source.targetAccountId,
    ...(source.accountId ? { source_account_id: source.accountId } : {}),
    run_id: runId,
    collector_version: COLLECTOR_VERSION,
    author_followers: post.author_followers ?? null,
    metrics: post.metrics,
  };

  const ref = adminDb.collection("external_post_observations").doc(receipt.id);
  try {
    await ref.create(receipt);
  } catch (error) {
    const detail = error as { code?: string | number; message?: string };
    const alreadyExists =
      detail.code === 6 ||
      detail.code === "6" ||
      detail.code === "already-exists" ||
      /already exists/i.test(detail.message ?? "");
    if (!alreadyExists) throw error;
    const existing = await ref.get();
    const current = existing.data() as ExternalPostObservationDoc | undefined;
    if (
      !current ||
      current.external_post_id !== receipt.external_post_id ||
      current.discovery_query_id !== receipt.discovery_query_id ||
      current.text_hash !== receipt.text_hash ||
      current.canonical_url !== receipt.canonical_url ||
      current.discovery_mode !== receipt.discovery_mode
    ) {
      throw new Error(`Immutable external observation receipt conflict: ${receipt.id}`);
    }
  }
}

export async function syncExternalDiscovery(
  account: AccountDoc,
  options: { runId?: string } = {},
): Promise<{
  synced: string[];
  cached: number;
  budget: RapidApiBudgetState;
  stoppedByBudget: boolean;
}> {
  const now = DateTime.utc();
  const jstDate = now.setZone("Asia/Tokyo").toISODate()!;
  const runId = options.runId ?? `external_${jstDate.replace(/-/g, "")}`;
  const initialBudget = await getRapidApiBudgetState();
  const synced: string[] = [];
  const keywords = account.discoveryKeywords ?? [];
  const referenceIds = account.referenceAccountIds ?? [];

  if (initialBudget.budget === null || initialBudget.remaining === null || initialBudget.exhausted) {
    return { synced, cached: 0, budget: initialBudget, stoppedByBudget: true };
  }

  // Freshness comes from one small state doc per source. It used to be derived
  // by scanning up to 900 stored posts per account on every run.
  const state = await getDiscoveryState(account.id, [...keywords, ...referenceIds]);
  const isFresh = (key: string) => {
    const last = state[key];
    if (!last) return false;
    const at = DateTime.fromISO(last);
    return at.isValid && now.diff(at, "hours").hours < cacheHours();
  };

  // Alternate acquisition modes across cache windows without increasing paid requests.
  const searchWindowBucket = Math.floor(now.toMillis() / (cacheHours() * 60 * 60 * 1000));
  const discoveryMode: "Top" | "Latest" = searchWindowBucket % 2 === 0 ? "Top" : "Latest";
  const sourceCap = maxSourcesPerRun();
  let fresh = 0;

  const referenceAccounts = referenceIds.length
    ? ((await getReferenceAccounts(referenceIds)) as ReferenceAccountDoc[])
    : [];
  const referenceById = new Map(referenceAccounts.map((item) => [item.id, item]));

  // Cap the combined source list, not each kind separately, so the per-run
  // budget is a real per-account cap.
  const sources: Array<{ kind: "keyword" | "account"; key: string }> = [
    ...keywords.map((key) => ({ kind: "keyword" as const, key })),
    ...referenceAccounts.map((item) => ({ kind: "account" as const, key: item.id })),
  ];

  for (const source of pickRotating(sources, sourceCap, now)) {
    if (isFresh(source.key)) {
      fresh += 1;
      continue;
    }
    // Two monthly-budget slots are protected for the Blind Top + Latest pair.
    const currentBudget = await getRapidApiBudgetState();
    if (currentBudget.remaining === null || currentBudget.remaining <= 2) {
      return { synced, cached: fresh, budget: currentBudget, stoppedByBudget: true };
    }

    if (source.kind === "keyword") {
      const posts = await fetchXSearchPosts(source.key, {
        limit: POSTS_PER_SOURCE,
        searchType: discoveryMode,
        reserveRequests: 2,
      });
      const fetchedAt = DateTime.utc().toISO()!;
      for (const post of posts) {
        if (TEXT_ONLY && post.media_type !== "text") continue;
        const sourceInfo = {
          targetAccountId: account.id,
          keyword: source.key,
          discoveryMode,
          discoveryOrigin: "account_keyword" as const,
          discoveryQueryId: `keyword:${source.key}`,
        };
        const external = toExternalPost(post, fetchedAt, sourceInfo);
        await appendExternalObservation(external, sourceInfo, runId, fetchedAt);
        await upsertExternalPost(external);
      }
      await saveDiscoveryState(account.id, source.key, now.toISO()!);
      synced.push(`keyword:${source.key}:${discoveryMode}`);
      continue;
    }

    const reference = referenceById.get(source.key);
    if (!reference) {
      // The reference was removed between listing and syncing.
      fresh += 1;
      continue;
    }
    const posts = await fetchRecentXPosts(
      { id: reference.id, platform: "x", handle: reference.handle, display_name: reference.display_name ?? reference.handle, connected: true, scopes: [], created_at: now.toISO()!, updated_at: now.toISO()! },
      { limit: POSTS_PER_SOURCE, reserveRequests: 2 },
    );
    const fetchedAt = DateTime.utc().toISO()!;
    for (const post of posts.posts) {
      if (TEXT_ONLY && post.media_type !== "text") continue;
      const sourceInfo = {
        targetAccountId: account.id,
        accountId: reference.id,
        discoveryOrigin: "reference_account" as const,
        discoveryQueryId: `reference:${reference.id}`,
      };
      const external = toExternalPost(post, fetchedAt, sourceInfo);
      await appendExternalObservation(external, sourceInfo, runId, fetchedAt);
      await upsertExternalPost(external);
    }
    await saveDiscoveryState(account.id, source.key, now.toISO()!);
    synced.push(`account:${reference.handle}`);
  }

  const finalBudget = await getRapidApiBudgetState();
  return { synced, cached: fresh, budget: finalBudget, stoppedByBudget: false };
}
