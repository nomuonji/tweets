
import axios from "axios";
import { DateTime } from "luxon";
import type { AccountDoc, MediaType, PostMetrics } from "@/lib/types";
import type { SyncPostPayload } from "./types";
import { incrementApiUsage } from "@/lib/services/usage-service";
import { TwitterApi } from "twitter-api-v2";
import type { PublishResult } from "./types";

type FetchOptions = {
  startTime?: string;
  limit?: number;
};

const DEFAULT_RAPID_API_HOST = "twitter-api45.p.rapidapi.com";
const MAX_RESULTS = 100;
const MAX_FETCH_PAGES = 50;
const MAX_FETCH_ATTEMPTS = 3;
const RESPONSE_SNIPPET_LIMIT = 400;

type RapidApiTweetLegacy = {
  id_str?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  favorite_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  views?: { count?: number };
  retweeted_status_id_str?: string;
  retweeted_status_result?: unknown;
  in_reply_to_status_id_str?: string;
  in_reply_to_status_id?: string | number | null;
  in_reply_to_screen_name?: string | null;
  in_reply_to_user_id_str?: string;
  in_reply_to_user_id?: string | number | null;
  extended_entities?: {
    media?: Array<{ type?: string }>;
  };
  entities?: {
    urls?: Array<unknown>;
    media?: Array<{ type?: string }>;
  };
};

type RapidApiTweetResult = {
  rest_id?: string;
  legacy?: RapidApiTweetLegacy;
};

type RapidApiInstruction = {
  type?: string;
  entries?: RapidApiEntry[];
};

type RapidApiEntry = {
  content?: {
    itemContent?: {
      tweet_results?: {
        result?: RapidApiTweetResult | { result?: RapidApiTweetResult };
      };
    };
    content?: {
      tweetResult?: {
        result?: RapidApiTweetResult;
      };
    };
  };
};

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return null;
}

function getNested(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current) {
      return undefined;
    }
    const record = toRecord(current);
    if (!record || !(key in record)) {
      return undefined;
    }
    return record[key];
  }, source);
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function resolveRapidApiKey(account: AccountDoc) {
  return account.token_meta?.api_key ?? process.env.RAPIDAPI_KEY;
}

function resolveRapidApiHost(account: AccountDoc) {
  return account.token_meta?.api_host ?? process.env.RAPIDAPI_HOST ?? DEFAULT_RAPID_API_HOST;
}

function extractTweetResult(entry: RapidApiEntry): RapidApiTweetResult | null {
  const itemContent = entry.content?.itemContent;
  if (itemContent?.tweet_results?.result) {
    const result = itemContent.tweet_results.result as RapidApiTweetResult & {
      result?: RapidApiTweetResult;
    };
    if ("legacy" in result || "rest_id" in result) {
      return result;
    }
    if (result.result) {
      return result.result;
    }
  }

  const nested = entry.content?.content?.tweetResult?.result;
  if (nested) {
    return nested;
  }

  return null;
}

function collectEntries(data: unknown): RapidApiEntry[] {
  const instructionPaths = [
    ["result", "timeline", "instructions"],
    ["data", "user", "result", "timeline_v2", "timeline", "instructions"],
    ["timeline", "instructions"],
  ];

  for (const path of instructionPaths) {
    const instructions = toArray<RapidApiInstruction>(getNested(data, path));
    if (instructions.length > 0) {
      return instructions.flatMap((instruction) => instruction.entries ?? []);
    }
  }

  return [];
}

function extractFromGlobalObjects(data: unknown): RapidApiTweetResult[] {
  const tweetsRecord = toRecord(getNested(data, ["globalObjects", "tweets"]));
  if (!tweetsRecord) {
    return [];
  }

  return Object.entries(tweetsRecord)
    .map(([id, value]) => {
      const tweetRecord = toRecord(value);
      if (!tweetRecord) {
        return null;
      }
      const legacyCandidate = toRecord(tweetRecord.legacy);
      const legacy = (legacyCandidate ?? tweetRecord) as RapidApiTweetLegacy;
      return {
        rest_id: id,
        legacy,
      } as RapidApiTweetResult;
    })
    .filter((value): value is RapidApiTweetResult => value !== null);
}

function truncateForLog(value: string): string {
  if (value.length <= RESPONSE_SNIPPET_LIMIT) {
    return value;
  }
  return `${value.slice(0, RESPONSE_SNIPPET_LIMIT)}c (truncated)`;
}

function stringifyForLog(value: unknown): string {
  if (typeof value === "string") {
    return truncateForLog(value);
  }
  try {
    return truncateForLog(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function formatParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function parseCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function detectMediaTypeFromMedia(media: UnknownRecord | null): MediaType | null {
  if (!media) {
    return null;
  }
  const video = toArray<unknown>(media.video);
  if (video.length > 0) {
    return "video";
  }
  const photo = toArray<unknown>(media.photo);
  if (photo.length > 0) {
    return "image";
  }
  return null;
}

function hasUrls(entities: UnknownRecord | null, text: string): boolean {
  if (entities) {
    const urls = toArray<unknown>(entities.urls);
    if (urls.length > 0) {
      return true;
    }
  }
  return text.includes("http://") || text.includes("https://");
}

function isLegacyRetweet(legacy?: RapidApiTweetLegacy): boolean {
  if (!legacy) {
    return false;
  }
  const rawText = (legacy.full_text ?? legacy.text ?? "").trim();
  if (rawText.startsWith("RT @")) {
    return true;
  }
  if (legacy.retweeted_status_result || legacy.retweeted_status_id_str) {
    return true;
  }
  return false;
}

function isSimpleEntryRetweet(entry: UnknownRecord | null): boolean {
  if (!entry) {
    return false;
  }
  const rawText = typeof entry.text === "string" ? entry.text.trim() : "";
  if (rawText.startsWith("RT @")) {
    return true;
  }
  if ("retweeted" in entry || "retweeted_tweet" in entry) {
    return true;
  }
  return false;
}

function isLegacyReply(legacy?: RapidApiTweetLegacy): boolean {
  if (!legacy) {
    return false;
  }
  const replyTargets = [
    legacy.in_reply_to_status_id_str,
    legacy.in_reply_to_status_id,
    legacy.in_reply_to_user_id,
    legacy.in_reply_to_user_id_str,
    legacy.in_reply_to_screen_name,
  ];
  return replyTargets.some((value) => {
    if (typeof value === "number") {
      return value > 0;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return false;
  });
}

function isSimpleEntryReply(entry: UnknownRecord | null): boolean {
  if (!entry) {
    return false;
  }
  const flag = entry.is_reply;
  if (flag === true || flag === 1 || flag === "1") {
    return true;
  }
  const replyKeys = [
    "in_reply_to_status_id",
    "in_reply_to_status_id_str",
    "in_reply_to_user_id",
    "in_reply_to_user_id_str",
    "in_reply_to_screen_name",
    "reply_to_tweet_id",
    "reply_to_user_id",
    "replying_to",
  ];
  for (const key of replyKeys) {
    const value = entry[key];
    if (typeof value === "number" && value > 0) {
      return true;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return true;
    }
  }
  const objectKeys = ["in_reply_to", "reply_to"];
  return objectKeys.some((key) => {
    const value = entry[key];
    return value !== null && typeof value === "object";
  });
}

function extractSimpleTimeline(
  data: unknown,
  screenName: string,
  debug: string[],
): SyncPostPayload[] {
  const record = toRecord(data);
  if (!record) {
    return [];
  }

  const candidates: SyncPostPayload[] = [];

  const pinned = toRecord(record.pinned);
  if (pinned) {
    const payload = mapSimpleTimelineEntry(pinned, screenName, debug);
    if (payload) {
      candidates.push(payload);
    }
  }

  const timeline = toArray<unknown>(record.timeline);
  for (const entry of timeline) {
    const payload = mapSimpleTimelineEntry(toRecord(entry), screenName, debug);
    if (payload) {
      candidates.push(payload);
    }
  }

  return candidates;
}

function mapSimpleTimelineEntry(
  entry: UnknownRecord | null,
  screenName: string,
  debug: string[],
): SyncPostPayload | null {
  if (isSimpleEntryRetweet(entry)) {
    debug.push("Skipped retweet entry from simple timeline");
    return null;
  }
  if (isSimpleEntryReply(entry)) {
    debug.push("Skipped reply entry from simple timeline");
    return null;
  }
  if (!entry) {
    return null;
  }

  const tweetId = typeof entry.tweet_id === "string" ? entry.tweet_id : undefined;
  if (!tweetId) {
    return null;
  }

  const createdRaw =
    typeof entry.created_at === "string" ? entry.created_at : undefined;
  if (!createdRaw) {
    return null;
  }

  const createdIso = normalizeDate(createdRaw);
  if (!createdIso) {
    debug.push(`Failed to parse created_at "${createdRaw}" for tweet ${tweetId}`);
    return null;
  }

  const text = typeof entry.text === "string" ? entry.text : "";
  const entities = toRecord(entry.entities);
  const media = toRecord(entry.media);
  const retweetedTweet = toRecord(entry.retweeted_tweet);
  const quotedTweet = toRecord(entry.quoted);

  let mediaType =
    detectMediaTypeFromMedia(media) ??
    detectMediaTypeFromMedia(toRecord(retweetedTweet?.media)) ??
    detectMediaTypeFromMedia(toRecord(quotedTweet?.media));
  if (!mediaType) {
    mediaType = "text";
  }

  const metrics: PostMetrics = {
    impressions: entry.views !== undefined ? parseCount(entry.views) : null,
    likes: parseCount(entry.favorites),
    replies: parseCount(entry.replies),
    reposts_or_rethreads: parseCount(entry.retweets),
    quotes: entry.quotes !== undefined ? parseCount(entry.quotes) : undefined,
    link_clicks: null,
  };

  const hasUrl =
    hasUrls(entities, text) ||
    hasUrls(toRecord(retweetedTweet?.entities), text) ||
    hasUrls(toRecord(quotedTweet?.entities), text);

  return {
    platform: "x",
    platform_post_id: tweetId,
    text,
    created_at: createdIso,
    media_type: mediaType,
    has_url: hasUrl,
    metrics,
    raw: entry as Record<string, unknown>,
    raw_gcs_url: undefined,
    url: `https://twitter.com/${screenName}/status/${tweetId}`,
  };
}

function normalizeDate(raw: string): string | null {
  const formats = [
    "ccc LLL dd HH:mm:ss ZZZ yyyy",
    "ccc MMM dd HH:mm:ss ZZZ yyyy",
    "EEE MMM dd HH:mm:ss ZZZ yyyy",
  ];

  let dt = DateTime.fromRFC2822(raw, { zone: "utc" });
  if (!dt.isValid) {
    for (const format of formats) {
      dt = DateTime.fromFormat(raw, format, { zone: "utc" });
      if (dt.isValid) {
        break;
      }
    }
  }

  if (!dt.isValid) {
    const jsDate = new Date(raw);
    if (!Number.isNaN(jsDate.getTime())) {
      dt = DateTime.fromJSDate(jsDate, { zone: "utc" });
    }
  }

  if (!dt.isValid) {
    return null;
  }

  return dt.toUTC().toISO();
}

function toMediaType(legacy?: RapidApiTweetLegacy): MediaType {
  const media =
    legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const types = new Set(
    media
      .map((item) => item?.type)
      .filter((type): type is string => typeof type === "string"),
  );

  if (types.has("video") || types.has("animated_gif")) {
    return "video";
  }
  if (types.has("photo")) {
    return "image";
  }
  return "text";
}

function toMetrics(legacy?: RapidApiTweetLegacy): PostMetrics {
  return {
    impressions: legacy?.views?.count ?? null,
    likes: legacy?.favorite_count ?? 0,
    replies: legacy?.reply_count ?? 0,
    reposts_or_rethreads: legacy?.retweet_count ?? 0,
    quotes: legacy?.quote_count,
    link_clicks: null,
  };
}

function resolveCreatedAt(value?: string): string | null {
  if (!value) {
    return null;
  }
  const parsed = DateTime.fromJSDate(new Date(value)).toUTC();
  if (!parsed.isValid) {
    return null;
  }
  return parsed.toISO();
}

function filterByStartTime(
  tweets: SyncPostPayload[],
  startTime?: string,
): SyncPostPayload[] {
  if (!startTime) {
    return tweets;
  }

  const threshold = DateTime.fromISO(startTime, { zone: "utc" });
  if (!threshold.isValid) {
    return tweets;
  }

  return tweets.filter((tweet) => {
    const created = DateTime.fromISO(tweet.created_at, { zone: "utc" });
    if (!created.isValid) {
      return true;
    }
    return created >= threshold;
  });
}

type FetchPostsResponse = {
  posts: SyncPostPayload[];
  debug: string[];
};

type TimelineRequestParams = {
  apiKey: string;
  apiHost: string;
  params: Record<string, string>;
  page: number;
  debug: string[];
};

async function requestTimelinePage({
  apiKey,
  apiHost,
  params,
  page,
  debug,
}: TimelineRequestParams) {
  const candidateEndpoints = ["user-tweets", "timeline.php", "timeline"];
  let lastAxiosError: unknown = null;

  for (const endpoint of candidateEndpoints) {
    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
      debug.push(
        `Page ${page} attempt ${attempt}/${MAX_FETCH_ATTEMPTS} ¨ /${endpoint}?${formatParams(params)}`,
      );
      try {
        const response = await axios.get<unknown>(`https://${apiHost}/${endpoint}`, {
          params,
          headers: {
            "X-RapidAPI-Key": apiKey,
            "X-RapidAPI-Host": apiHost,
          },
        });

        await incrementApiUsage("rapidapi_twitter").catch(() => {
          /* ignore usage counters in non-critical paths */
        });

        debug.push(
          `Success /${endpoint} (status ${response.status}) ? snippet: ${stringifyForLog(
            response.data,
          )}`,
        );
        return { data: response.data, endpoint };
      } catch (error) {
        lastAxiosError = error;
        if (!axios.isAxiosError(error)) {
          debug.push(`Non-Axios error: ${String(error)}`);
          throw error;
        }
        const status = error.response?.status;
        const detailText = stringifyForLog(error.response?.data ?? error.message);
        debug.push(
          `Failure /${endpoint} attempt ${attempt}${
            status ? ` (status ${status})` : ""
          }: ${detailText}`,
        );
        if (status && [401, 403].includes(status)) {
          const err = new Error(
            `RapidAPI authentication failed${status ? ` (status ${status})` : ""}: ${detailText}`,
          ) as Error & { debug?: string[] };
          err.debug = debug;
          throw err;
        }
        if (!status || status >= 500) {
          if (attempt < MAX_FETCH_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
            continue;
          }
          debug.push(
            `Giving up on /${endpoint} after ${attempt} attempts due to server-side error.`,
          );
          break;
        }
        // Other 4xx: try next endpoint.
        break;
      }
    }
  }

  if (axios.isAxiosError(lastAxiosError)) {
    const status = lastAxiosError.response?.status;
    const detail =
      typeof lastAxiosError.response?.data === "string"
        ? lastAxiosError.response?.data
        : JSON.stringify(lastAxiosError.response?.data ?? {});
    const err = new Error(
      `RapidAPI request failed${status ? ` (status ${status})` : ""}: ${detail}`,
    ) as Error & { debug?: string[] };
    err.debug = debug;
    throw err;
  }

  const err = new Error("RapidAPI request failed with an unknown error.") as Error & {
    debug?: string[];
  };
  err.debug = debug;
  throw err;
}

function extractNextCursor(data: unknown): string | undefined {
  const direct = getNested(data, ["next_cursor"]);
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const camel = getNested(data, ["nextCursor"]);
  if (typeof camel === "string" && camel.trim()) {
    return camel.trim();
  }
  return undefined;
}

function transformResponseToTweets(
  responseData: unknown,
  screenName: string,
  debug: string[],
) {
  const entries = collectEntries(responseData);
  debug.push(`Timeline entries found: ${entries.length}`);
  const results: RapidApiTweetResult[] =
    entries
      .map((entry) => extractTweetResult(entry))
      .filter((value): value is RapidApiTweetResult => Boolean(value));

  if (results.length === 0) {
    debug.push("No tweet results in timeline entries, checking fallbacks.");
    const fallbackArray: RapidApiTweetResult[] = [
      ...extractFromGlobalObjects(responseData),
      ...toArray<RapidApiTweetResult>(getNested(responseData, ["result"])),
      ...toArray<RapidApiTweetResult>(getNested(responseData, ["data"])),
    ];
    const filtered = fallbackArray.filter(Boolean);
    debug.push(`Fallback results collected: ${filtered.length}`);
    if (filtered.length > 0) {
      const mapped = filtered
        .map((result): SyncPostPayload | null => {
          const legacy = result.legacy ?? {};
          if (isLegacyRetweet(legacy)) {
            debug.push("Skipped retweet legacy fallback entry");
            return null;
          }
          if (isLegacyReply(legacy)) {
            debug.push("Skipped reply legacy fallback entry");
            return null;
          }
          const id = result.rest_id ?? legacy.id_str;
          const created = resolveCreatedAt(legacy.created_at);

          if (!id || !created) {
            return null;
          }

          const text = legacy.full_text ?? legacy.text ?? "";
          const metrics = toMetrics(legacy);
          const mediaType = toMediaType(legacy);
          const hasUrl = Boolean(legacy.entities?.urls?.length);

          return {
            platform: "x",
            platform_post_id: id,
            text,
            created_at: created,
            media_type: mediaType,
            has_url: hasUrl,
            metrics,
            raw: {
              rest_id: result.rest_id,
              legacy,
            },
            url: `https://twitter.com/${screenName}/status/${id}`,
            raw_gcs_url: undefined,
          };
        })
        .filter((value): value is SyncPostPayload => value !== null);

      if (mapped.length > 0) {
        return mapped;
      }
    }

    const simpleTimeline = extractSimpleTimeline(responseData, screenName, debug);
    debug.push(`Simple timeline items parsed: ${simpleTimeline.length}`);
    return simpleTimeline;
  }

  const tweets = results
    .map((result): SyncPostPayload | null => {
      const legacy = result.legacy ?? {};
      if (isLegacyRetweet(legacy)) {
        debug.push("Skipped retweet legacy entry");
        return null;
      }
      if (isLegacyReply(legacy)) {
        debug.push("Skipped reply legacy entry");
        return null;
      }
      const id = result.rest_id ?? legacy.id_str;
      const created = resolveCreatedAt(legacy.created_at);

      if (!id || !created) {
        return null;
      }

      const text = legacy.full_text ?? legacy.text ?? "";
      const metrics = toMetrics(legacy);
      const mediaType = toMediaType(legacy);
      const hasUrl = Boolean(legacy.entities?.urls?.length);

      return {
        platform: "x",
        platform_post_id: id,
        text,
        created_at: created,
        media_type: mediaType,
        has_url: hasUrl,
        metrics,
        raw: {
          rest_id: result.rest_id,
          legacy,
        },
        url: `https://twitter.com/${screenName}/status/${id}`,
        raw_gcs_url: undefined,
      };
    })
    .filter((value): value is SyncPostPayload => value !== null);

  if (tweets.length > 0) {
    debug.push(`Primary timeline results mapped: ${tweets.length}`);
    return tweets;
  }

  const simpleTimeline = extractSimpleTimeline(responseData, screenName, debug);
  debug.push(`Simple timeline items parsed: ${simpleTimeline.length}`);
  return simpleTimeline;
}

export async function fetchRecentXPosts(
  account: AccountDoc,
  options: FetchOptions,
): Promise<FetchPostsResponse> {
  const screenName = account.handle.replace(/^@/, "");
  const debug: string[] = [`Account handle: ${screenName}`];
  const apiKey = resolveRapidApiKey(account);
  const apiHost = resolveRapidApiHost(account);
  debug.push(`Resolved API host: ${apiHost ?? "undefined"}`);
  if (apiKey) {
    const keyPreview =
      apiKey.length > 8
        ? `${apiKey.slice(0, 4)}c${apiKey.slice(-4)}`
        : `${apiKey.slice(0, Math.max(0, apiKey.length - 2))}**`;
    debug.push(`API key preview: ${keyPreview}`);
  } else {
    debug.push("API key missing");
  }

  if (!apiKey || !apiHost) {
    const err = new Error(
      "RapidAPI credentials are not configured for this account.",
    ) as Error & { debug?: string[] };
    err.debug = debug;
    throw err;
  }

  const userId = account.token_meta?.user_id;
  const targetLimit = options.limit ?? MAX_RESULTS;
  debug.push(`Using host: ${apiHost}`);
  debug.push(`Target limit: ${targetLimit}`);
  debug.push(
    options.startTime ? `Start time filter: ${options.startTime}` : "Start time: none",
  );

  const aggregated: SyncPostPayload[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let stopDueToStartTime = false;

  for (let page = 1; page <= MAX_FETCH_PAGES && aggregated.length < targetLimit; page += 1) {
    const remaining = targetLimit - aggregated.length;
    const pageLimit = Math.min(Math.max(remaining, 1), MAX_RESULTS);
    const params: Record<string, string> = {
      count: String(pageLimit),
      username: screenName,
      screenname: screenName,
    };
    if (userId) {
      params.user_id = userId;
      params.userId = userId;
    }
    if (cursor) {
      params.cursor = cursor;
    }

    const { data } = await requestTimelinePage({
      apiKey,
      apiHost,
      params,
      page,
      debug,
    });

    const pageTweets = transformResponseToTweets(data, screenName, debug);
    if (pageTweets.length === 0) {
      debug.push("No tweets returned for this page.");
    }

    const filteredPageTweets = filterByStartTime(pageTweets, options.startTime);

    if (options.startTime && pageTweets.length > 0 && filteredPageTweets.length === 0) {
      debug.push("All tweets in this page are older than startTime; stopping early.");
      stopDueToStartTime = true;
    }

    for (const tweet of filteredPageTweets) {
      if (!seen.has(tweet.platform_post_id)) {
        seen.add(tweet.platform_post_id);
        aggregated.push(tweet);
      }
    }

    const nextCursor = extractNextCursor(data);
    debug.push(nextCursor ? `Next cursor: ${nextCursor}` : "No next cursor returned.");
    cursor = nextCursor;

    if (!cursor || pageTweets.length === 0 || stopDueToStartTime) {
      break;
    }
  }

  aggregated.sort(
    (a, b) =>
      DateTime.fromISO(b.created_at).toMillis() -
      DateTime.fromISO(a.created_at).toMillis(),
  );

  const finalPosts = aggregated.slice(0, targetLimit);
  debug.push(
    `Tweets after pagination: ${aggregated.length}, returning: ${finalPosts.length}`,
  );

  return { posts: finalPosts, debug };
}

export async function publishXPost(
  account: AccountDoc,
  payload: { text: string },
): Promise<PublishResult> {
  const { token_meta } = account;
  if (!token_meta) {
    throw new Error("X account token metadata is missing.");
  }

  // OAuth 2.0 (for user context)
  if (token_meta.oauth_version === "oauth2" && token_meta.access_token) {
    const client = new TwitterApi(token_meta.access_token);
    const { data: createdTweet } = await client.v2.tweet(payload.text);

    if (!createdTweet) {
      throw new Error("Failed to create tweet using v2 API.");
    }

    return {
      platform_post_id: createdTweet.id,
      url: `https://twitter.com/${account.handle}/status/${createdTweet.id}`,
      raw: createdTweet as unknown as Record<string, unknown>,
    };
  }

  // OAuth 1.0a (legacy)
  if (
    token_meta.oauth_version === "oauth1" &&
    token_meta.consumer_key &&
    token_meta.consumer_secret &&
    token_meta.access_token &&
    token_meta.access_token_secret
  ) {
    const client = new TwitterApi({
      appKey: token_meta.consumer_key,
      appSecret: token_meta.consumer_secret,
      accessToken: token_meta.access_token,
      accessSecret: token_meta.access_token_secret,
    });
    const { data: createdTweet } = await client.v1.tweet(payload.text);

    if (!createdTweet) {
      throw new Error("Failed to create tweet using v1 API.");
    }

    return {
      platform_post_id: createdTweet.id_str,
      url: `https://twitter.com/${createdTweet.user.screen_name}/status/${createdTweet.id_str}`,
      raw: createdTweet as unknown as Record<string, unknown>,
    };
  }

  throw new Error("No valid X credentials found for posting.");
}
