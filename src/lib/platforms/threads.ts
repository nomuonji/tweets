import axios from "axios";
import { DateTime } from "luxon";
import type { AccountDoc, PostMetrics } from "@/lib/types";
import type { PublishResult, SyncPostPayload } from "./types";

const THREADS_API_BASE = "https://graph.threads.net";
const THREADS_PAGE_LIMIT = 100;
const THREADS_MAX_FETCH_PAGES = 25;
const THREADS_DEFAULT_LIMIT = 100;
const CONTAINER_POLL_ATTEMPTS = 12;
const CONTAINER_POLL_INTERVAL_MS = 500;
const CONTAINER_CREATE_ATTEMPTS = 2;
const POST_PUBLISH_CYCLES = 2;
const RECONCILIATION_ATTEMPTS = 3;
const RECONCILIATION_INTERVAL_MS = Number(
  process.env.THREADS_RECONCILIATION_INTERVAL_MS ?? 1500,
);

export type ThreadsPublishStage =
  | "creating_container"
  | "container_created"
  | "container_ready"
  | "publishing"
  | "reconciling";

export type ThreadsPublishProgress = {
  stage: ThreadsPublishStage;
  attempt: number;
  creationId?: string;
};

export type ThreadsPublishOptions = {
  startedAt?: string;
  onProgress?: (progress: ThreadsPublishProgress) => Promise<void> | void;
};

export type ThreadsApiErrorKind =
  | "media_not_found"
  | "rate_limited"
  | "auth"
  | "transient"
  | "ambiguous_publish"
  | "unknown";

export type ThreadsApiErrorDetails = {
  stage: "container_create" | "container_status" | "publish" | "reconcile";
  kind: ThreadsApiErrorKind;
  status?: number;
  code?: number;
  subcode?: number;
  isTransient?: boolean;
};

export class ThreadsPublishError extends Error {
  constructor(
    message: string,
    public readonly details: ThreadsApiErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ThreadsPublishError";
  }
}

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
  media_type?: "VIDEO" | "IMAGE" | "TEXT" | "REPOST_FACADE" | "TEXT_POST";
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

export function describeThreadsApiError(
  operation: string,
  error: unknown,
): Error {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error
      ? error
      : new Error(`${operation}: ${String(error)}`);
  }

  const status = error.response?.status;
  const detail =
    typeof error.response?.data === "string"
      ? error.response.data
      : JSON.stringify(error.response?.data ?? {});
  return new Error(
    `${operation}${status ? ` (HTTP ${status})` : ""}: ${detail || error.message}`,
  );
}

export function classifyThreadsApiError(
  stage: ThreadsApiErrorDetails["stage"],
  error: unknown,
): ThreadsApiErrorDetails {
  if (error instanceof ThreadsPublishError) return error.details;
  if (!axios.isAxiosError(error)) return { stage, kind: "unknown" };

  const status = error.response?.status;
  const body = error.response?.data as {
    error?: {
      code?: number;
      error_subcode?: number;
      is_transient?: boolean;
    };
  } | undefined;
  const code = body?.error?.code;
  const subcode = body?.error?.error_subcode;
  const isTransient = body?.error?.is_transient;

  let kind: ThreadsApiErrorKind = "unknown";
  if (code === 24 && subcode === 4279009) {
    kind = "media_not_found";
  } else if (status === 429 || code === 4 || code === 17 || code === 32) {
    kind = "rate_limited";
  } else if (status === 401 || status === 403 || code === 190) {
    kind = "auth";
  } else if (isTransient === true || (typeof status === "number" && status >= 500)) {
    kind = stage === "publish" ? "ambiguous_publish" : "transient";
  } else if (stage === "publish" && !error.response) {
    // A timeout/disconnect can happen after Meta accepted the publish. Retrying
    // blindly could create a duplicate visible post.
    kind = "ambiguous_publish";
  }

  return { stage, kind, status, code, subcode, isTransient };
}

function toThreadsPublishError(
  operation: string,
  stage: ThreadsApiErrorDetails["stage"],
  error: unknown,
): ThreadsPublishError {
  const described = describeThreadsApiError(operation, error);
  return new ThreadsPublishError(
    described.message,
    classifyThreadsApiError(stage, error),
    { cause: error },
  );
}

function normalizePostText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function shouldRetryThreadsContainerCreation(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  // Container creation is not public and is safe to retry once. Threads has
  // occasionally returned a transient 400 for an unchanged valid payload, in
  // addition to conventional rate-limit and server errors.
  return status === 400 || status === 429 || (typeof status === "number" && status >= 500);
}

async function waitForContainer(
  accessToken: string,
  creationId: string,
): Promise<void> {
  for (let attempt = 1; attempt <= CONTAINER_POLL_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await axios.get<{
        id?: string;
        status?: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED";
        error_message?: string;
      }>(`${THREADS_API_BASE}/${creationId}`, {
        params: {
          fields: "id,status,error_message",
          access_token: accessToken,
        },
      });
    } catch (error) {
      throw toThreadsPublishError(
        "Threads container status check failed",
        "container_status",
        error,
      );
    }
    const status = response.data?.status;

    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(
        `Threads media container ${status.toLowerCase()}: ${response.data?.error_message ?? creationId}`,
      );
    }

    if (attempt < CONTAINER_POLL_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS),
      );
    }
  }

  throw new Error(
    `Threads media container was not ready after ${CONTAINER_POLL_ATTEMPTS} checks: ${creationId}`,
  );
}

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
    quotes: undefined,
    link_clicks: undefined,
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

      if (item.media_type && item.media_type !== "TEXT_POST") {
        debug.push(`Skipped non-text post (${item.media_type})`);
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


export async function getThreadsUserProfile(accessToken: string): Promise<{
  id: string;
  name?: string;
  username?: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}> {
  const url = `https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url,threads_biography&access_token=${accessToken}`;
  const profileResponse = await fetch(url);

  if (!profileResponse.ok) {
    const errorDetail = await profileResponse.text();
    throw new Error(
      `Failed to fetch Threads user profile: ${profileResponse.status} ${errorDetail}`,
    );
  }

  const profile = (await profileResponse.json()) as {
    id?: string;
    name?: string;
    username?: string;
    threads_profile_picture_url?: string;
    threads_biography?: string;
  };

  if (!profile.id) {
    throw new Error("Could not retrieve Threads user ID from profile response.");
  }

  return profile as {
    id: string;
    name?: string;
    username?: string;
    threads_profile_picture_url?: string;
    threads_biography?: string;
  };
}

export async function publishThreadsPost(
  account: AccountDoc,
  payload: { text: string; mediaUrls?: string[]; url?: string },
  options: ThreadsPublishOptions = {},
): Promise<PublishResult> {
  const accessToken = getThreadsAccessToken(account);
  if (!accessToken) {
    throw new Error("Threads access token is not configured");
  }

  const userId = getThreadsUserId(account);
  if (!userId) {
    throw new Error("Threads user ID is not configured");
  }

  const startedAt = options.startedAt ?? DateTime.utc().toISO()!;

  for (let cycle = 1; cycle <= POST_PUBLISH_CYCLES; cycle += 1) {
    await options.onProgress?.({ stage: "creating_container", attempt: cycle });

    let containerResponse: { data?: { id?: string } } | null = null;
    let lastCreateError: unknown;
    for (let attempt = 1; attempt <= CONTAINER_CREATE_ATTEMPTS; attempt += 1) {
      try {
        containerResponse = await axios.post<{ id: string }>(
          `${THREADS_API_BASE}/${userId}/threads`,
          {
            media_type: "TEXT",
            text: payload.text,
            access_token: accessToken,
          },
        );
        break;
      } catch (error) {
        lastCreateError = error;
        if (
          attempt === CONTAINER_CREATE_ATTEMPTS ||
          !shouldRetryThreadsContainerCreation(error)
        ) {
          throw toThreadsPublishError(
            "Threads post container creation failed",
            "container_create",
            error,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }

    if (!containerResponse) {
      throw toThreadsPublishError(
        "Threads post container creation failed",
        "container_create",
        lastCreateError,
      );
    }

    const creationId = containerResponse.data?.id;
    if (typeof creationId !== "string") {
      throw new ThreadsPublishError(
        "Failed to create Threads media container: creation_id not found",
        { stage: "container_create", kind: "unknown" },
      );
    }
    await options.onProgress?.({
      stage: "container_created",
      attempt: cycle,
      creationId,
    });

    try {
      await waitForContainer(accessToken, creationId);
    } catch (error) {
      throw toThreadsPublishError(
        "Threads post container status check failed",
        "container_status",
        error,
      );
    }
    await options.onProgress?.({
      stage: "container_ready",
      attempt: cycle,
      creationId,
    });
    await options.onProgress?.({
      stage: "publishing",
      attempt: cycle,
      creationId,
    });

    let publishResponse;
    try {
      publishResponse = await axios.post<{ id: string }>(
        `${THREADS_API_BASE}/${userId}/threads_publish`,
        {
          creation_id: creationId,
          access_token: accessToken,
        },
      );
    } catch (error) {
      const details = classifyThreadsApiError("publish", error);
      if (details.kind === "media_not_found" && cycle < POST_PUBLISH_CYCLES) {
        continue;
      }

      if (details.kind === "ambiguous_publish") {
        await options.onProgress?.({
          stage: "reconciling",
          attempt: cycle,
          creationId,
        });
        const recovered = await reconcileThreadsPost(
          account,
          payload.text,
          startedAt,
        );
        if (recovered) return recovered;
      }

      throw toThreadsPublishError(
        "Threads post publish failed",
        "publish",
        error,
      );
    }

    const publishedPostId = publishResponse.data?.id;
    if (typeof publishedPostId !== "string") {
      throw new ThreadsPublishError(
        "Failed to publish Threads container: final post ID not found",
        { stage: "publish", kind: "ambiguous_publish" },
      );
    }

    const handle = account.handle.startsWith("@") ? account.handle.slice(1) : account.handle;
    return {
      platform_post_id: publishedPostId,
      raw: publishResponse.data,
      url: `https://www.threads.net/@${handle}/post/${publishedPostId}`,
    };
  }

  throw new ThreadsPublishError(
    "Threads post publish failed after replacing a missing media container",
    { stage: "publish", kind: "media_not_found", code: 24, subcode: 4279009 },
  );
}

/** Resolve an uncertain response by looking for the exact text on the timeline. */
export async function reconcileThreadsPost(
  account: AccountDoc,
  text: string,
  startedAt: string,
): Promise<PublishResult | null> {
  const threshold = DateTime.fromISO(startedAt).minus({ minutes: 2 });
  const expected = normalizePostText(text);

  for (let attempt = 1; attempt <= RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      const { posts } = await fetchRecentThreadsPosts(account, { limit: 20 });
      const match = posts.find((post) => {
        const created = DateTime.fromISO(post.created_at);
        return (
          created.isValid &&
          (!threshold.isValid || created >= threshold) &&
          normalizePostText(post.text) === expected
        );
      });
      if (match) {
        return {
          platform_post_id: match.platform_post_id,
          raw: { ...match.raw, reconciled_after_ambiguous_publish: true },
          url: match.url,
        };
      }
    } catch (error) {
      if (attempt === RECONCILIATION_ATTEMPTS) {
        console.warn(
          `[Threads] Reconciliation failed: ${describeThreadsApiError("timeline fetch", error).message}`,
        );
      }
    }

    if (attempt < RECONCILIATION_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, RECONCILIATION_INTERVAL_MS),
      );
    }
  }
  return null;
}

/**
 * 引用投稿（Quote Post）を作成
 * 他のユーザーの投稿を引用して新しい投稿を作成します
 */
export async function publishThreadsQuotePost(
  account: AccountDoc,
  payload: { text: string; quotePostId: string },
): Promise<PublishResult> {
  const accessToken = getThreadsAccessToken(account);
  if (!accessToken) {
    throw new Error("Threads access token is not configured");
  }

  const userId = getThreadsUserId(account);
  if (!userId) {
    throw new Error("Threads user ID is not configured");
  }

  // Step 1: Create a media container with quote_post_id
  const containerResponse = await axios.post<{ id: string }>(
    `${THREADS_API_BASE}/${userId}/threads`,
    {
      media_type: "TEXT",
      text: payload.text,
      quote_post_id: payload.quotePostId,
      access_token: accessToken,
    },
  );

  const creationId = containerResponse.data?.id;
  if (typeof creationId !== "string") {
    throw new Error("Failed to create Threads quote post container: creation_id not found");
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
    throw new Error("Failed to publish Threads quote post: final post ID not found");
  }

  const handle = account.handle.startsWith("@") ? account.handle.slice(1) : account.handle;
  const permalink = `https://www.threads.net/@${handle}/post/${publishedPostId}`;

  return {
    platform_post_id: publishedPostId,
    raw: publishResponse.data,
    url: permalink,
  };
}

/**
 * 返信（Reply）を作成
 * 特定の投稿に対して返信を投稿します
 */
export async function publishThreadsReply(
  account: AccountDoc,
  payload: { text: string; replyToId: string },
): Promise<PublishResult> {
  const accessToken = getThreadsAccessToken(account);
  if (!accessToken) {
    throw new Error("Threads access token is not configured");
  }

  const userId = getThreadsUserId(account);
  if (!userId) {
    throw new Error("Threads user ID is not configured");
  }

  // Step 1: Create a media container with reply_to_id. This operation is not
  // public, so retrying it once cannot create a duplicate visible reply.
  let containerResponse: { data?: { id?: string } } | null = null;
  let lastContainerError: unknown;
  for (let attempt = 1; attempt <= CONTAINER_CREATE_ATTEMPTS; attempt += 1) {
    try {
      containerResponse = await axios.post<{ id: string }>(
        `${THREADS_API_BASE}/${userId}/threads`,
        {
          media_type: "TEXT",
          text: payload.text,
          reply_to_id: payload.replyToId.replace(/^threads_/, ""),
          access_token: accessToken,
        },
      );
      break;
    } catch (error) {
      lastContainerError = error;
      if (
        attempt === CONTAINER_CREATE_ATTEMPTS ||
        !shouldRetryThreadsContainerCreation(error)
      ) {
        throw describeThreadsApiError(
          "Threads reply container creation failed",
          error,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  if (!containerResponse) {
    throw describeThreadsApiError(
      "Threads reply container creation failed",
      lastContainerError,
    );
  }

  const creationId = containerResponse.data?.id;
  if (typeof creationId !== "string") {
    throw new Error("Failed to create Threads reply container: creation_id not found");
  }

  await waitForContainer(accessToken, creationId);

  // Step 2: Publish the media container
  let publishResponse;
  try {
    publishResponse = await axios.post<{ id: string }>(
      `${THREADS_API_BASE}/${userId}/threads_publish`,
      {
        creation_id: creationId,
        access_token: accessToken,
      },
    );
  } catch (error) {
    // Publishing is intentionally not retried: if the response was lost after
    // Meta accepted it, retrying could create a duplicate visible reply.
    throw describeThreadsApiError("Threads reply publish failed", error);
  }

  const publishedPostId = publishResponse.data?.id;
  if (typeof publishedPostId !== "string") {
    throw new Error("Failed to publish Threads reply: final post ID not found");
  }

  const handle = account.handle.startsWith("@") ? account.handle.slice(1) : account.handle;
  const permalink = `https://www.threads.net/@${handle}/post/${publishedPostId}`;

  return {
    platform_post_id: publishedPostId,
    raw: publishResponse.data,
    url: permalink,
  };
}
