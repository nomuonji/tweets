import { DateTime } from "luxon";
import type { AccountDoc, ExternalPostDoc, ReferenceAccountDoc } from "@/lib/types";
import { engagementRate, extractPattern } from "@/lib/pattern";
import { fetchRecentXPosts, fetchXSearchPosts } from "@/lib/platforms/x";
import {
  getExternalPostsForAccount,
  getReferenceAccounts,
  upsertExternalPost,
} from "./firestore.server";
import { getRapidApiBudgetState, type RapidApiBudgetState } from "./usage-service";

const POSTS_PER_SOURCE = 20;
/** Discovery is about reusable text structure, so media-only posts are useless. */
const TEXT_ONLY = true;

/**
 * How long a keyword/reference result is reused before another paid request.
 * Default 24h. Raise it (e.g. 168) when the API plan is small.
 */
function cacheHours(): number {
  const parsed = Number(process.env.DISCOVERY_CACHE_HOURS ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

/**
 * How many of an account's saved sources may be paid for in one run. 0 or unset
 * means "all of them". Stored keywords are kept, so a small budget still covers
 * every keyword over time instead of deleting them.
 */
function maxSourcesPerRun(): number {
  const parsed = Number(process.env.DISCOVERY_MAX_SOURCES_PER_ACCOUNT ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * Rotate deterministically by ISO week so a capped run still walks through the
 * whole keyword list across weeks, without storing rotation state.
 */
function pickRotating<T>(items: T[], count: number, now: DateTime): T[] {
  if (count <= 0 || items.length <= count) return items;
  const week = Math.floor(now.toMillis() / (7 * 24 * 60 * 60 * 1000));
  const start = week % items.length;
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
  for (const key of ["user_info", "author"]) {
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

function shouldRefresh(posts: ExternalPostDoc[], key: string, now: DateTime) {
  const latest = posts
    .filter((post) => post.search_keyword === key || post.source_account_id === key)
    .map((post) => DateTime.fromISO(post.fetched_at))
    .filter((date) => date.isValid)
    .sort((a, b) => b.toMillis() - a.toMillis())[0];
  return !latest || now.diff(latest, "hours").hours >= cacheHours();
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
  source: { keyword?: string; accountId?: string },
): ExternalPostDoc {
  const external = {
    id: `x_external_${post.platform_post_id}`,
    platform: "x" as const,
    platform_post_id: post.platform_post_id,
    author_handle: authorHandle(post),
    author_followers: authorFollowers(post),
    text: post.text,
    created_at: post.created_at,
    url: post.url,
    metrics: post.metrics,
    search_keyword: source.keyword,
    source_account_id: source.accountId,
    fetched_at: now,
  } satisfies ExternalPostDoc;
  return {
    ...external,
    engagement_rate: engagementRate(external.metrics),
    pattern: extractPattern(post.text),
  };
}

export async function syncExternalDiscovery(account: AccountDoc): Promise<{
  synced: string[];
  cached: number;
  budget: RapidApiBudgetState;
  stoppedByBudget: boolean;
}> {
  const now = DateTime.utc();
  const budget = await getRapidApiBudgetState();
  const existing = await getExternalPostsForAccount({
    ...account,
    discoveryKeywords: account.discoveryKeywords ?? [],
    referenceAccountIds: account.referenceAccountIds ?? [],
  }, 300);
  const synced: string[] = [];

  if (budget.exhausted) {
    return { synced, cached: existing.length, budget, stoppedByBudget: true };
  }

  // One paid request per source; stop as soon as this run reaches the remaining
  // monthly allowance instead of discovering the ceiling the hard way.
  let spent = 0;
  const canSpend = () => budget.remaining === null || spent < budget.remaining;
  const sourceCap = maxSourcesPerRun();

  for (const keyword of pickRotating(account.discoveryKeywords ?? [], sourceCap, now)) {
    if (!shouldRefresh(existing, keyword, now)) continue;
    if (!canSpend()) {
      return { synced, cached: existing.length, budget, stoppedByBudget: true };
    }
    const posts = await fetchXSearchPosts(keyword, {
      limit: POSTS_PER_SOURCE,
      searchType: "Top",
    });
    spent += 1;
    for (const post of posts) {
      if (TEXT_ONLY && post.media_type !== "text") continue;
      await upsertExternalPost(toExternalPost(post, now.toISO()!, { keyword }));
    }
    synced.push(`keyword:${keyword}`);
  }

  const referenceAccounts = await getReferenceAccounts(
    account.referenceAccountIds ?? [],
  );
  for (const reference of pickRotating(referenceAccounts as ReferenceAccountDoc[], sourceCap, now)) {
    if (!shouldRefresh(existing, reference.id, now)) continue;
    if (!canSpend()) {
      return { synced, cached: existing.length, budget, stoppedByBudget: true };
    }
    const posts = await fetchRecentXPosts(
      { id: reference.id, platform: "x", handle: reference.handle, display_name: reference.display_name ?? reference.handle, connected: true, scopes: [], created_at: now.toISO()!, updated_at: now.toISO()! },
      { limit: POSTS_PER_SOURCE },
    );
    spent += 1;
    for (const post of posts.posts) {
      if (TEXT_ONLY && post.media_type !== "text") continue;
      await upsertExternalPost(
        toExternalPost(post, now.toISO()!, { accountId: reference.id }),
      );
    }
    synced.push(`account:${reference.handle}`);
  }

  return { synced, cached: existing.length, budget, stoppedByBudget: false };
}
