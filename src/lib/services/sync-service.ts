import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { calculateScore } from "@/lib/scoring";
import {
  AccountDoc,
  PostDoc,
  SettingsDoc,
  ScoreOptions,
  Platform,
} from "@/lib/types";
import { fetchRecentXPosts } from "@/lib/platforms/x";
import { fetchRecentThreadsPosts } from "@/lib/platforms/threads";
import { SyncPostPayload } from "@/lib/platforms/types";
import { getAccounts, getSettings, upsertPost } from "./firestore.server";

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

type SyncResult = {
  accountId: string;
  handle: string;
  displayName?: string;
  platform: Platform;
  fetched: number;
  stored: number;
  error?: string;
  debug: string[];
};

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

function scorePost(
  payload: SyncPostPayload,
  settings: SettingsDoc["scoring"],
  scoreOptions: Partial<ScoreOptions> = {},
) {
  return calculateScore(
    {
      metrics: {
        impressions: payload.metrics.impressions,
        likes: payload.metrics.likes,
        replies: payload.metrics.replies,
        reposts_or_rethreads: payload.metrics.reposts_or_rethreads,
        link_clicks: payload.metrics.link_clicks ?? 0,
      },
    },
    { settings, proxyValue: scoreOptions.proxyValue },
  );
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

  const platformDefault = account.platform === "threads" ? 100 : 20;
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

function toPostDocument(
  account: AccountDoc,
  payload: SyncPostPayload,
  settings: SettingsDoc["scoring"],
): PostDoc {
  const score = scorePost(payload, settings);
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
    metrics: payload.metrics,
    score,
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

function fallbackSettings(): SettingsDoc {
  return {
    id: "fallback",
    scoring: {
      use_impression_proxy:
        String(process.env.SCORE_USE_IMPRESSION_PROXY).toLowerCase() === "true",
      proxy_strategy:
        process.env.SCORE_IMPRESSION_PROXY_STRATEGY === "1" ? "1" : "median",
    },
    generation: {
      max_hashtags: Number(process.env.MAX_HASHTAGS ?? 2) || 2,
      preferred_length: [120, 140],
    },
    slots: {
      x: [],
      threads: [],
    },
  };
}

export async function syncPostsForAllAccounts(
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  const [accounts, settings] = await Promise.all([
    getAccounts(),
    getSettings(options.projectId),
  ]);

  const activeSettings = settings ?? fallbackSettings();
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
      const posts = payloads.map((item) =>
        toPostDocument(account, item, activeSettings.scoring),
      );

      for (const post of posts) {
        await upsertPost(post);
      }

      if (payloads.length > 0) {
        const latest = payloads
          .map((item) => item.created_at)
          .sort()
          .at(-1);
        if (latest) {
          await updateAccountCursor(account, latest);
        }
      }

      results.push({
        accountId: account.id,
        handle: account.handle,
        displayName: account.display_name,
        platform: account.platform,
        fetched: payloads.length,
        stored: posts.length,
        debug: [
          ...debug,
          `Fetched payloads: ${payloads.length}`,
          `Stored posts: ${posts.length}`,
        ],
      });

    } catch (error) {
      console.error("[Sync] Failed to sync account", account.id, error);
      results.push({
        accountId: account.id,
        handle: account.handle,
        displayName: account.display_name,
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




