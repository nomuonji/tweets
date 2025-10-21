import axios from "axios";
import { DateTime } from "luxon";
import type { AccountDoc, PostMetrics } from "@/lib/types";
import type { PublishResult, SyncPostPayload } from "./types";

const THREADS_API_BASE = "https://graph.threads.net";
const THREADS_PAGE_LIMIT = 100;
const THREADS_MAX_FETCH_PAGES = 25;
const THREADS_DEFAULT_LIMIT = 100;

type FetchOptions = {
  since?: string;
  limit?: number;
};

function getThreadsAccessToken(account?: AccountDoc) {
  return account?.token_meta?.access_token ?? process.env.THREADS_ACCESS_TOKEN;
}

function getThreadsUserId(account?: AccountDoc) {
  const configured =
    account?.token_meta?.user_id ?? process.env.THREADS_USER_ID ?? "";
  if (configured.trim().length > 0) {
    return configured.trim();
  }
  const handle = account?.handle?.trim();
  if (!handle) {
    return undefined;
  }
  return handle.startsWith("@") ? handle.slice(1) : handle;
}

type InsightValue = {
  value: number;
};

type InsightMetric = {
  name: string;
  period: string;
  values: InsightValue[];
  title: string;
  description: string;
  id: string;
};

type ThreadsItem = {
  id: string;
  text?: string;
  timestamp: string;
  media_type?: "VIDEO" | "IMAGE" | "TEXT";
  permalink?: string;
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  insights?: {
    data?: InsightMetric[];
  };
  is_reply?: boolean | number | string;
  reply_to_id?: string;
  parent_id?: string;
  replying_to?: string;
};

type ThreadsPaging = {
  cursors?: {
    after?: string;
    before?: string;
  };
  next?: string;
};

type ThreadsResponse = {
  data?: ThreadsItem[];
  paging?: ThreadsPaging;
};

function getInsightValue(item: ThreadsItem, name: "views" | "impressions" | "likes" | "replies" | "reposts"): number | null {
  if (!item.insights?.data) {
    return null;
  }
  const metricData = item.insights.data.find(d => d.name === name);
  if (!metricData || !metricData.values || metricData.values.length === 0) {
    return null;
  }
  const value = metricData.values[0].value;
  return typeof value === 'number' ? value : null;
}

function mapMetrics(item: ThreadsItem): PostMetrics {
  const views = getInsightValue(item, "views");
  const impressions = getInsightValue(item, "impressions");
  const likes = getInsightValue(item, "likes");
  const replies = getInsightValue(item, "replies");
  const reposts = getInsightValue(item, "reposts");

  return {
    impressions: views ?? impressions ?? null,
    likes: likes ?? item.like_count ?? 0,
    replies: replies ?? item.reply_count ?? 0,
    reposts_or_rethreads: reposts ?? item.repost_count ?? 0,
    quotes: null,
    link_clicks: null,
  };
}

type FetchThreadsResult = {
  posts: SyncPostPayload[];
  debug: string[];
};

function isThreadsReply(item: ThreadsItem): boolean {
  const candidates = [
    item.reply_to_id,
    item.parent_id,
    item.replying_to,
  ];
  if (item.is_reply === true || item.is_reply === 1 || item.is_reply === "1") {
    return true;
  }
  return candidates.some((value) => typeof value === "string" && value.trim().length > 0);
}

function toSyncPayload(item: ThreadsItem): SyncPostPayload | null {
  const createdUtc = DateTime.fromISO(item.timestamp).toUTC();
  const createdIso = createdUtc.toISO();
  if (!createdIso) {
    return null;
  }
  return {
    platform: "threads" as const,
    platform_post_id: item.id,
    text: item.text ?? "",
    created_at: createdIso,
    media_type:
      item.media_type === "VIDEO"
        ? "video"
        : item.media_type === "IMAGE"
          ? "image"
          : "text",
    has_url: Boolean(item.text && item.text.includes("http")),
    metrics: mapMetrics(item),
    raw: item as unknown as Record<string, unknown>,
    url: item.permalink ?? undefined,
  };
}

export async function fetchRecentThreadsPosts(
  account: AccountDoc,
  options: FetchOptions,
): Promise<FetchThreadsResult> {
  const debug: string[] = [`Account handle: ${account.handle}`];

  const accessToken = getThreadsAccessToken(account);
  if (!accessToken) {
    const err = new Error("Threads access token is not configured") as Error & {
      debug?: string[];
    };
    err.debug = debug;
    throw err;
  }

  const userId = getThreadsUserId(account);
  if (!userId) {
    const err = new Error("Threads user ID is not configured") as Error & {
      debug?: string[];
    };
    err.debug = debug;
    throw err;
  }

  const requestedLimit = options.limit ?? THREADS_DEFAULT_LIMIT;
  const targetLimit = Math.max(1, requestedLimit);
  const sinceRaw = options.since ? DateTime.fromISO(options.since) : null;
  const sinceDate = sinceRaw?.isValid ? sinceRaw.toUTC() : undefined;
  const hasSinceFilter = Boolean(sinceDate);

  debug.push(`Resolved user ID: ${userId}`);
  debug.push(`Target limit: ${targetLimit}`);
  if (hasSinceFilter) {
    debug.push(`Since: ${sinceDate?.toISO()}`);
  } else if (options.since) {
    debug.push(`Since: provided but invalid (${options.since})`);
  } else {
    debug.push("Since: none");
  }

  const aggregated: SyncPostPayload[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let stopDueToSince = false;

  for (
    let page = 1;
    page <= THREADS_MAX_FETCH_PAGES &&
      aggregated.length < targetLimit &&
      !stopDueToSince;
    page += 1
  ) {
    const remaining = targetLimit - aggregated.length;
    const pageLimit = Math.min(Math.max(remaining, 1), THREADS_PAGE_LIMIT);
    const params: Record<string, unknown> = {
      access_token: accessToken,
      limit: pageLimit,
      fields:
        "id,text,timestamp,media_type,permalink,like_count,reply_count,repost_count,is_reply,reply_to_id,parent_id,replying_to,insights.metric(views,likes,replies,reposts)",
    };
    if (cursor) {
      params.after = cursor;
    }

    debug.push(
      `Requesting page ${page} with limit ${pageLimit}${cursor ? ` (after=${cursor})` : ""}`,
    );

    let response: { data?: ThreadsResponse };
    try {
      response = await axios.get<ThreadsResponse>(
        `${THREADS_API_BASE}/${userId}/threads`,
        {
          params,
        },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const detail =
          typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data ?? {});
        const err = new Error(
          `Threads API request failed${status ? ` (status ${status})` : ""}: ${detail}`,
        ) as Error & { debug?: string[] };
        err.debug = debug;
        throw err;
      }
      const err = new Error("Threads API request failed") as Error & {
        debug?: string[];
      };
      err.debug = debug;
      throw err;
    }

    const items = response.data?.data ?? [];
    debug.push(`Page ${page} items received: ${items.length}`);

    if (items.length === 0) {
      debug.push("No items returned; stopping pagination.");
      break;
    }

    let pageHasNewerItem = false;

    for (const item of items) {
      debug.push(`Processing item ${item.id}: ${JSON.stringify(item)}`);

      if (isThreadsReply(item)) {
        debug.push(`Skipped reply item ${item.id}`);
        continue;
      }

      if (item.media_type === "REPOST_FACADE") {
        debug.push(`Skipped repost_facade item ${item.id}`);
        continue;
      }

      if (hasSinceFilter && sinceDate) {
        const created = DateTime.fromISO(item.timestamp).toUTC();
        if (created <= sinceDate) {
          debug.push(`Item ${item.id} skipped (too old)`);
          continue;
        }
        pageHasNewerItem = true;
      }

      const payload = toSyncPayload(item);
      if (!payload) {
        debug.push(`Item ${item.id} skipped (payload creation failed). Reason: Could not parse timestamp '${item.timestamp}'`);
        continue;
      }

      if (seen.has(payload.platform_post_id)) {
        debug.push(`Item ${item.id} skipped (duplicate)`);
        continue;
      }

      debug.push(`Item ${item.id} added to collection`);
      seen.add(payload.platform_post_id);
      aggregated.push(payload);

      if (aggregated.length >= targetLimit) {
        break;
      }
    }

    if (hasSinceFilter && !pageHasNewerItem) {
      debug.push("Page contained no items newer than since-date; stopping.");
      stopDueToSince = true;
    }

    if (aggregated.length >= targetLimit) {
      debug.push("Reached target limit; stopping pagination.");
      break;
    }

    const nextUrl = response.data?.paging?.next;
    let nextCursorFromUrl: string | null | undefined;
    if (nextUrl) {
      try {
        nextCursorFromUrl = new URL(nextUrl).searchParams.get("after");
      } catch (error) {
        debug.push(
          `Failed to parse paging.next URL: ${(error as Error).message}`,
        );
      }
    }

    const nextCursor =
      response.data?.paging?.cursors?.after ?? nextCursorFromUrl ?? undefined;

    cursor = nextCursor ?? undefined;
    debug.push(cursor ? `Next cursor: ${cursor}` : "No next cursor; stopping.");

    if (!cursor) {
      break;
    }
  }

  aggregated.sort(
    (a, b) =>
      DateTime.fromISO(b.created_at).toMillis() -
      DateTime.fromISO(a.created_at).toMillis(),
  );

  const finalPosts = aggregated.slice(0, targetLimit);
  debug.push(`Collected posts: ${aggregated.length}, returning: ${finalPosts.length}`);

  return { posts: finalPosts, debug };
}

export async function publishThreadsPost(
  account: AccountDoc,
  payload: { text: string; mediaUrls?: string[]; url?: string },
): Promise<PublishResult> {
  const accessToken = getThreadsAccessToken(account);
  if (!accessToken) {
    throw new Error("Threads access token is not configured");
  }

  const userId = getThreadsUserId(account);
  if (!userId) {
    throw new Error("Threads user ID is not configured");
  }

  // Step 1: Create a media container
  const containerResponse = await axios.post<{ id: string }>(
    `${THREADS_API_BASE}/${userId}/threads`,
    {
      media_type: "TEXT",
      text: payload.text,
      access_token: accessToken,
    },
  );

  const creationId = containerResponse.data?.id;
  if (typeof creationId !== "string") {
    throw new Error("Failed to create Threads media container: creation_id not found");
  }

  // Step 2: Publish the media container
  const publishResponse = await axios.post<{ id: string }>(
    `${THREADS_API_BASE}/${userId}/threads_publish`,
    {
      creation_id: creationId,
      access_token: accessToken,
    },
  );

  const publishedPostId = publishResponse.data?.id;
  if (typeof publishedPostId !== "string") {
    throw new Error("Failed to publish Threads container: final post ID not found");
  }

  const handle = account.handle.startsWith("@") ? account.handle.slice(1) : account.handle;
  const permalink = `https://www.threads.net/@${handle}/post/${publishedPostId}`;

  return {
    platform_post_id: publishedPostId,
    raw: publishResponse.data,
    url: permalink,
  };
}
