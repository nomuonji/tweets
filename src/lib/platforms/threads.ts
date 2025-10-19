import axios from "axios";
import { DateTime } from "luxon";
import type { AccountDoc, PostMetrics } from "@/lib/types";
import type { PublishResult, SyncPostPayload } from "./types";

const THREADS_API_BASE = "https://graph.threads.net";

type FetchOptions = {
  since?: string;
  limit?: number;
};

function getThreadsAccessToken(account?: AccountDoc) {
  return account?.token_meta?.access_token ?? process.env.THREADS_ACCESS_TOKEN;
}

type ThreadsItem = {
  id: string;
  text?: string;
  created_time: string;
  media_type?: "VIDEO" | "IMAGE" | "TEXT";
  permalink?: string;
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  insights?: { impressions?: number };
  is_reply?: boolean | number | string;
  reply_to_id?: string;
  parent_id?: string;
  replying_to?: string;
};

type ThreadsResponse = {
  data?: ThreadsItem[];
};

function mapMetrics(item: ThreadsItem): PostMetrics {
  return {
    impressions: item.insights?.impressions ?? null,
    likes: item.like_count ?? 0,
    replies: item.reply_count ?? 0,
    reposts_or_rethreads: item.repost_count ?? 0,
    quotes: undefined,
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

  const userId = account.token_meta?.user_id ?? account.handle;
  debug.push(`User ID: ${userId}`);
  const params: Record<string, unknown> = {
    access_token: accessToken,
    limit: Math.min(options.limit ?? 50, 50),
    fields: "id,text,created_time,media_type,permalink,like_count,reply_count",
  };
  debug.push(`Limit: ${params.limit}`);
  debug.push(options.since ? `Since: ${options.since}` : "Since: none");

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
  debug.push(`Threads items returned: ${items.length}`);

  const nonReplyItems = items.filter((item) => {
    const isReply = isThreadsReply(item);
    if (isReply) {
      debug.push(`Skipped reply item ${item.id}`);
    }
    return !isReply;
  });
  debug.push(`Items after reply filter: ${nonReplyItems.length}`);

  const filtered = nonReplyItems.filter((item) => {
    if (!options.since) {
      return true;
    }
    const created = DateTime.fromISO(item.created_time).toUTC();
    return created > DateTime.fromISO(options.since).toUTC();
  });
  debug.push(`Items after since filter: ${filtered.length}`);

  const mapped = filtered
    .map((item): SyncPostPayload | null => {
      const createdUtc = DateTime.fromISO(item.created_time).toUTC();
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
    })
    .filter((value): value is SyncPostPayload => value !== null);

  debug.push(`Returning posts: ${mapped.length}`);

  return { posts: mapped, debug };
}

export async function publishThreadsPost(
  account: AccountDoc,
  payload: { text: string; mediaUrls?: string[]; url?: string },
): Promise<PublishResult> {
  const accessToken = getThreadsAccessToken(account);
  if (!accessToken) {
    throw new Error("Threads access token is not configured");
  }

  const userId = account.token_meta?.user_id ?? account.handle;
  const postResponse = await axios.post<Record<string, unknown>>(
    `${THREADS_API_BASE}/${userId}/threads`,
    {
      text: payload.text,
      media: payload.mediaUrls,
      url: payload.url,
      access_token: accessToken,
    },
  );

  const publishIdValue = postResponse.data?.["id"];
  if (typeof publishIdValue !== "string") {
    throw new Error("Failed to publish Threads post");
  }

  const permalinkValue = postResponse.data?.["permalink"];
  const permalink =
    typeof permalinkValue === "string" ? permalinkValue : undefined;

  return {
    platform_post_id: publishIdValue,
    raw: postResponse.data,
    url: permalink,
  };
}
