import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { calculateScore } from "@/lib/scoring";
import { extractPattern } from "@/lib/pattern";
import { AccountDoc, PostDoc, Platform, PostMetrics } from "@/lib/types";
import { fetchRecentXPosts } from "@/lib/platforms/x";
import { fetchRecentThreadsPosts } from "@/lib/platforms/threads";
import { SyncPostPayload } from "@/lib/platforms/types";
import { getAccounts, upsertPost } from "./firestore.server";
import { reconcileAffiliateLinkForPost } from "./affiliate-tracking-service";
import {
  getLastSuccessfulPromoReplyTime,
  isPromoReplyEligible,
  maybePromoReply,
} from "./promo-reply-service";
import {
  DEFAULT_STEADY_STATE_FETCH_LIMIT,
  selectPostsForPersistence,
} from "./sync-policy";

type SyncOptions = {
  lookbackDays?: number;
  maxPosts?: number;
  projectId?: string;
  accountIds?: string[];
};

type FetchPostsResult = {
  posts: SyncPostPayload[];
  debug: string[];
};

export type SyncResult = {
  accountId: string;
  handle: string;
  displayName?: string;
  platform: Platform;
  fetched: number;
  stored: number;
  promoReplies?: number;
  promoAttempts?: number;
  promoFailures?: number;
  promoHaltedReason?: string;
  affiliateLinksReconciled?: number;
  error?: string;
  debug: string[];
};

const MAX_PROMO_REPLIES_PER_SYNC = 2;

function parsePositiveNumber(value?: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getDefaults(): { lookbackDays?: number; maxPostsCap?: number } {
  const lookbackDays = parsePositiveNumber(
    process.env.SYNC_INITIAL_LOOKBACK_DAYS?.trim() ?? null,
  );
  const maxPostsCap = parsePositiveNumber(
    process.env.SYNC_MAX_POSTS?.trim() ?? null,
  );

  return {
    lookbackDays,
    maxPostsCap,
  };
}

function normalizeMetrics(metrics: PostMetrics): PostMetrics {
  return {
    impressions: metrics.impressions ?? null,
    likes: metrics.likes ?? 0,
    replies: metrics.replies ?? 0,
    reposts_or_rethreads: metrics.reposts_or_rethreads ?? 0,
    quotes: metrics.quotes ?? 0,
    link_clicks: metrics.link_clicks ?? null,
  };
}

async function fetchPostsForAccount(
  account: AccountDoc,
  options: SyncOptions,
): Promise<FetchPostsResult> {
  const defaults = getDefaults();
  const lookbackInput = options.lookbackDays ?? defaults.lookbackDays;
  const lookbackDays =
    typeof lookbackInput === "number" && lookbackInput > 0
      ? lookbackInput
      : undefined;

  const platformDefault =
    account.platform === "threads" && !account.sync_cursor
      ? 100
      : DEFAULT_STEADY_STATE_FETCH_LIMIT;
  const requestedMax = options.maxPosts;
  let maxPosts =
    typeof requestedMax === "number" && requestedMax > 0
      ? requestedMax
      : platformDefault;

  if (defaults.maxPostsCap) {
    maxPosts = Math.min(maxPosts, defaults.maxPostsCap);
  }
  maxPosts = Math.max(1, Math.floor(maxPosts));

  let startTime: string | undefined;
  if (lookbackDays) {
    startTime = DateTime.utc().minus({ days: lookbackDays }).toUTC().toISO();
  }

  const debugLines = [
    lookbackDays ? `Mode: lookback (${lookbackDays}d)` : "Mode: latest posts (default)",
    `Fetch limit: ${maxPosts}`,
  ];

  if (account.platform === "x") {
    const result = await fetchRecentXPosts(account, {
      startTime,
      limit: maxPosts,
    });
    return {
      posts: result.posts,
      debug: [...debugLines, ...result.debug],
    };
  }

  const result = await fetchRecentThreadsPosts(account, {
    since: startTime,
    limit: maxPosts,
  });

  return {
    posts: result.posts,
    debug: [...debugLines, ...result.debug],
  };
}

function toPostDocument(account: AccountDoc, payload: SyncPostPayload): PostDoc {
  const normalizedMetrics = normalizeMetrics(payload.metrics);
  const score = calculateScore({ metrics: normalizedMetrics });
  const createdAtIso = DateTime.fromISO(payload.created_at).toUTC().toISO();

  return {
    id: `${account.platform}_${payload.platform_post_id}`,
    account_id: account.id,
    platform: account.platform,
    platform_post_id: payload.platform_post_id,
    text: payload.text,
    created_at: createdAtIso,
    media_type: payload.media_type,
    has_url: payload.has_url,
    metrics: normalizedMetrics,
    score,
    pattern: extractPattern(payload.text),
    raw: payload.raw,
    raw_gcs_url: payload.raw_gcs_url ?? null,
    url: payload.url ?? null,
    fetched_at: DateTime.utc().toISO(),
  } as PostDoc;
}

async function updateAccountCursor(account: AccountDoc, cursor: string) {
  await adminDb.collection("accounts").doc(account.id).set(
    {
      sync_cursor: cursor,
      updated_at: DateTime.utc().toISO(),
    },
    { merge: true },
  );
}

export async function syncPostsForAllAccounts(
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  const accounts = await getAccounts();
  const filterSet =
    options.accountIds && options.accountIds.length > 0
      ? new Set(options.accountIds)
      : null;

  const targetAccounts = filterSet
    ? accounts.filter((account) => filterSet.has(account.id))
    : accounts;

  if (targetAccounts.length === 0) {
    return [];
  }

  const results: SyncResult[] = [];

  for (const account of targetAccounts) {
    try {
      const { posts: payloads, debug } = await fetchPostsForAccount(
        account,
        options,
      );
      const payloadsToPersist = selectPostsForPersistence(account, payloads);
      const posts = payloadsToPersist.map((item) =>
        toPostDocument(account, item),
      );

      let affiliateLinksReconciled = 0;
      for (const post of posts) {
        await upsertPost(post);
        try {
          const reconciliation = await reconcileAffiliateLinkForPost(post.id);
          if (reconciliation.status === "linked") affiliateLinksReconciled += 1;
        } catch (error) {
          console.error("[Sync] Affiliate link reconciliation failed for post", post.id, error);
        }
      }

      // Process the strongest posts first, while still storing every fetched post.
      // The second reply in the same sync bypasses the normal inter-sync cooldown;
      // the per-sync cap prevents a burst larger than two replies per account.
      let promoReplies = 0;
      let promoAttempts = 0;
      let promoFailures = 0;
      let promoHaltedReason: string | undefined;
      const promoNow = DateTime.utc();
      const promoCandidates = posts
        .filter((post) => isPromoReplyEligible(account, post, promoNow))
        .sort((a, b) =>
          b.score - a.score ||
          (b.metrics.impressions ?? 0) - (a.metrics.impressions ?? 0),
        );
      const lastSuccessfulReplyAt = promoCandidates.length > 0
        ? await getLastSuccessfulPromoReplyTime(account)
        : null;
      for (const post of promoCandidates) {
        if (
          promoReplies >= MAX_PROMO_REPLIES_PER_SYNC ||
          promoAttempts >= MAX_PROMO_REPLIES_PER_SYNC ||
          promoHaltedReason
        ) break;
        const attempt = await maybePromoReply(account, post, promoNow, {
          ignoreCooldown: promoReplies > 0,
          lastSuccessfulReplyAt,
        });
        if (attempt.attempted) promoAttempts += 1;
        if (attempt.outcome === "posted") promoReplies += 1;
        if (attempt.outcome === "failed") promoFailures += 1;
        if (attempt.haltAccount) {
          promoHaltedReason = attempt.reason ?? "provider_unavailable";
        }
      }

      if (payloads.length > 0) {
        const latest = payloads
          .map((item) => item.created_at)
          .sort()
          .at(-1);
        if (latest && (!account.sync_cursor || latest > account.sync_cursor)) {
          await updateAccountCursor(account, latest);
        }
      }

      results.push({
        accountId: account.id,
        handle: account.handle,
        ...(account.display_name ? { displayName: account.display_name } : {}),
        platform: account.platform,
        fetched: payloads.length,
        stored: posts.length,
        promoReplies,
        promoAttempts,
        promoFailures,
        ...(promoHaltedReason ? { promoHaltedReason } : {}),
        affiliateLinksReconciled,
        debug: [
          ...debug,
          `Fetched payloads: ${payloads.length}`,
          `Selected for persistence: ${payloadsToPersist.length}`,
          `Stored posts: ${posts.length}`,
          `Promo replies posted: ${promoReplies}`,
          `Promo reply attempts: ${promoAttempts}`,
          `Promo reply failures: ${promoFailures}`,
          `Affiliate links reconciled: ${affiliateLinksReconciled}`,
          ...(promoHaltedReason
            ? [`Promo replies halted: ${promoHaltedReason}`]
            : []),
        ],
      });

    } catch (error) {
      console.error("[Sync] Failed to sync account", account.id, error);
      results.push({
        accountId: account.id,
        handle: account.handle,
        ...(account.display_name ? { displayName: account.display_name } : {}),
        platform: account.platform,
        fetched: 0,
        stored: 0,
        error: (error as Error).message,
        debug:
          error instanceof Error && "debug" in error && Array.isArray(error.debug)
            ? (error.debug as string[])
            : [],
      });
    }
  }

  return results;
}




