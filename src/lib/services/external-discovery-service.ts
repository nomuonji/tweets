import { DateTime } from "luxon";
import type { AccountDoc, ExternalPostDoc, ReferenceAccountDoc } from "@/lib/types";
import { engagementRate, extractPattern } from "@/lib/pattern";
import { fetchRecentXPosts, fetchXSearchPosts } from "@/lib/platforms/x";
import {
  getExternalPostsForAccount,
  getReferenceAccounts,
  upsertExternalPost,
} from "./firestore.server";

const CACHE_HOURS = 24;
const POSTS_PER_SOURCE = 20;

function authorHandle(post: { raw?: Record<string, unknown> }): string {
  const raw = post.raw ?? {};
  const author = raw.author;
  if (author && typeof author === "object") {
    const handle = (author as Record<string, unknown>).screen_name;
    if (typeof handle === "string" && handle.trim()) return handle;
  }
  return "unknown";
}

function shouldRefresh(posts: ExternalPostDoc[], key: string, now: DateTime) {
  const latest = posts
    .filter((post) => post.search_keyword === key || post.source_account_id === key)
    .map((post) => DateTime.fromISO(post.fetched_at))
    .filter((date) => date.isValid)
    .sort((a, b) => b.toMillis() - a.toMillis())[0];
  return !latest || now.diff(latest, "hours").hours >= CACHE_HOURS;
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

export async function syncExternalDiscovery(account: AccountDoc) {
  const now = DateTime.utc();
  const existing = await getExternalPostsForAccount({
    ...account,
    discoveryKeywords: account.discoveryKeywords ?? [],
    referenceAccountIds: account.referenceAccountIds ?? [],
  }, 300);
  const synced: string[] = [];

  for (const keyword of account.discoveryKeywords ?? []) {
    if (!shouldRefresh(existing, keyword, now)) continue;
    const posts = await fetchXSearchPosts(keyword, {
      limit: POSTS_PER_SOURCE,
      searchType: "Top",
    });
    for (const post of posts) {
      await upsertExternalPost(toExternalPost(post, now.toISO()!, { keyword }));
    }
    synced.push(`keyword:${keyword}`);
  }

  const referenceAccounts = await getReferenceAccounts(
    account.referenceAccountIds ?? [],
  );
  for (const reference of referenceAccounts as ReferenceAccountDoc[]) {
    if (!shouldRefresh(existing, reference.id, now)) continue;
    const posts = await fetchRecentXPosts(
      { id: reference.id, platform: "x", handle: reference.handle, display_name: reference.display_name ?? reference.handle, connected: true, scopes: [], created_at: now.toISO()!, updated_at: now.toISO()! },
      { limit: POSTS_PER_SOURCE },
    );
    for (const post of posts.posts) {
      await upsertExternalPost(
        toExternalPost(post, now.toISO()!, { accountId: reference.id }),
      );
    }
    synced.push(`account:${reference.handle}`);
  }

  return { synced, cached: existing.length };
}
