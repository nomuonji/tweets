import { DateTime } from "luxon";
import type { ExternalPostDoc, ExternalPostObservationDoc } from "@/lib/types";
import { adminDb } from "@/lib/firebase/admin";
import { engagementRate, extractPattern } from "@/lib/pattern";
import { fetchXSearchPosts } from "@/lib/platforms/x";
import { getRapidApiBudgetState } from "@/lib/services/usage-service";
import {
  buildBlindDiscoveryPlan,
  buildBlindObservationId,
  hashBlindSourceText,
} from "@/lib/blind-discovery";

const POSTS_PER_LANE = 20;
const COLLECTOR_VERSION = "blind-discovery-v1" as const;
const LEASE_MINUTES = 30;

type SearchPost = Awaited<ReturnType<typeof fetchXSearchPosts>>[number];

function getAuthorRecord(post: SearchPost): Record<string, unknown> | null {
  const raw = post.raw ?? {};
  for (const key of ["user_info", "author", "user"]) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function getAuthorHandle(post: SearchPost): string {
  const raw = post.raw ?? {};
  const record = getAuthorRecord(post);
  const value = record?.screen_name ?? record?.username ?? raw.screen_name ?? raw.username;
  return typeof value === "string" ? value.trim().replace(/^@/, "") : "";
}

function getAuthorFollowers(post: SearchPost): number | null {
  const value = getAuthorRecord(post)?.followers_count;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function asExternalPost(
  post: SearchPost,
  query: string,
  queryId: string,
  lane: "Top" | "Latest",
  fetchedAt: string,
): ExternalPostDoc {
  const authorHandle = getAuthorHandle(post);
  const canonicalUrl = post.url?.startsWith("https://")
    ? post.url
    : `https://x.com/i/web/status/${post.platform_post_id}`;
  const base = {
    id: `x_external_${post.platform_post_id}`,
    platform: "x" as const,
    platform_post_id: post.platform_post_id,
    author_handle: authorHandle,
    author_followers: getAuthorFollowers(post),
    text: post.text,
    created_at: post.created_at,
    url: canonicalUrl,
    metrics: post.metrics,
    search_keyword: query,
    discovery_mode: lane,
    discovery_origin: "blind_discovery" as const,
    discovery_query_id: queryId,
    fetched_at: fetchedAt,
  };
  return {
    ...base,
    engagement_rate: engagementRate(base.metrics),
    pattern: extractPattern(post.text),
  };
}

async function appendObservation(
  receipt: ExternalPostObservationDoc,
): Promise<"created" | "already_present"> {
  const ref = adminDb.collection("external_post_observations").doc(receipt.id);
  try {
    await ref.create(receipt);
    return "created";
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
      current.discovery_mode !== receipt.discovery_mode ||
      current.text_hash !== receipt.text_hash ||
      current.canonical_url !== receipt.canonical_url
    ) {
      throw new Error(`Immutable blind observation receipt conflict: ${receipt.id}`);
    }
    return "already_present";
  }
}

async function releaseLease(
  stateRef: FirebaseFirestore.DocumentReference,
  runId: string,
): Promise<void> {
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(stateRef);
    if (snapshot.get("lease_run_id") !== runId) return;
    transaction.set(stateRef, {
      lease_run_id: null,
      lease_until: null,
      updated_at: DateTime.utc().toISO(),
    }, { merge: true });
  });
}

export interface BlindDiscoveryRunResult {
  status: "completed" | "skipped" | "locked";
  runId?: string;
  seedId?: string;
  query?: string;
  topResults?: number;
  latestResults?: number;
  uniquePosts?: number;
  receiptsCreated?: number;
  receiptsReused?: number;
  budget?: {
    month: string;
    count: number;
    remaining: number | null;
    budget: number | null;
  };
  reason?: string;
}

/**
 * Account-blind external acquisition. This service intentionally never reads
 * accounts, reference accounts, drafts, personas or account performance.
 */
export async function runBlindExternalDiscovery(): Promise<BlindDiscoveryRunResult> {
  const now = DateTime.utc();
  const jstDate = now.setZone("Asia/Tokyo").toISODate()!;
  const stateRef = adminDb.collection("external_discovery_state").doc("global");
  const stateSnapshot = await stateRef.get();
  const state = stateSnapshot.data() ?? {};
  const cursorIndex = typeof state.next_seed_index === "number" ? state.next_seed_index : 0;

  if (state.last_completed_jst_date === jstDate) {
    return { status: "skipped", reason: "The independent discovery run for this JST date is already complete." };
  }

  const plan = buildBlindDiscoveryPlan(cursorIndex, jstDate);
  const runRef = adminDb.collection("external_discovery_runs").doc(plan.runId);
  const leaseUntilMs = now.plus({ minutes: LEASE_MINUTES }).toMillis();

  const claim = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(stateRef);
    const current = snapshot.data() ?? {};
    if (current.last_completed_jst_date === jstDate) return "completed" as const;
    const activeLease = typeof current.lease_until === "string"
      ? DateTime.fromISO(current.lease_until).toMillis()
      : 0;
    if (
      typeof current.lease_run_id === "string" &&
      current.lease_run_id.length > 0 &&
      Number.isFinite(activeLease) &&
      activeLease > now.toMillis()
    ) return "locked" as const;

    transaction.set(stateRef, {
      lease_run_id: plan.runId,
      lease_until: DateTime.fromMillis(leaseUntilMs).toISO(),
      current_seed_index: cursorIndex,
      current_seed_id: plan.seed.id,
      updated_at: now.toISO(),
    }, { merge: true });
    return "claimed" as const;
  });

  if (claim === "completed") {
    return { status: "skipped", reason: "The independent discovery run for this JST date completed in a concurrent worker." };
  }
  if (claim === "locked") {
    return { status: "locked", reason: "Another independent discovery run currently owns the collector lease." };
  }

  const startedAt = DateTime.utc().toISO()!;
  await runRef.set({
    run_id: plan.runId,
    status: "running",
    collector_version: COLLECTOR_VERSION,
    source_type: "account_independent_query",
    source_seed_id: plan.seed.id,
    source_theme: plan.seed.theme,
    source_language: plan.seed.language,
    search_keyword: plan.seed.query,
    query: plan.seed.query,
    discovery_query_id: plan.queryId,
    acquisition_lanes: [...plan.lanes],
    started_at: startedAt,
    jst_date: jstDate,
    account_independent: true,
    updated_at: startedAt,
  }, { merge: true });

  const initialBudget = await getRapidApiBudgetState();
  if (initialBudget.budget === null || initialBudget.remaining === null || initialBudget.remaining < 2) {
    await runRef.set({
      status: "budget_blocked",
      error: "An explicit monthly RapidAPI budget with at least two remaining requests is required.",
      budget: initialBudget,
      completed_at: DateTime.utc().toISO(),
      updated_at: DateTime.utc().toISO(),
    }, { merge: true });
    await releaseLease(stateRef, plan.runId);
    return {
      status: "skipped",
      runId: plan.runId,
      seedId: plan.seed.id,
      query: plan.seed.query,
      budget: {
        month: initialBudget.month,
        count: initialBudget.count,
        remaining: initialBudget.remaining,
        budget: initialBudget.budget,
      },
      reason: "Monthly RapidAPI budget is unset or fewer than two requests remain; no search was made.",
    };
  }

  const counts: Record<"Top" | "Latest", number> = { Top: 0, Latest: 0 };
  let uniquePosts = 0;
  let receiptsCreated = 0;
  let receiptsReused = 0;

  try {
    for (const lane of plan.lanes) {
      if (lane === "Latest") {
        const currentBudget = await getRapidApiBudgetState();
        if (currentBudget.remaining === null || currentBudget.remaining < 1) {
          throw new Error("RapidAPI budget was exhausted before the Latest acquisition lane.");
        }
      }

      const posts = await fetchXSearchPosts(plan.seed.query, {
        limit: POSTS_PER_LANE,
        searchType: lane,
      });
      counts[lane] = posts.length;
      const fetchedAt = DateTime.utc().toISO()!;

      for (const post of posts) {
        if (
          post.media_type !== "text" ||
          !post.text?.trim() ||
          !post.platform_post_id?.trim()
        ) continue;
        const authorHandle = getAuthorHandle(post);
        if (!authorHandle) continue;

        const external = asExternalPost(post, plan.seed.query, plan.queryId, lane, fetchedAt);
        const receipt: ExternalPostObservationDoc = {
          id: buildBlindObservationId(plan.runId, post.platform_post_id, lane),
          external_post_id: external.id,
          platform: "x",
          platform_post_id: external.platform_post_id,
          author_handle: authorHandle,
          canonical_url: external.url!,
          text_hash: hashBlindSourceText(external.text),
          created_at: external.created_at,
          fetched_at: fetchedAt,
          search_keyword: plan.seed.query,
          discovery_query_id: plan.queryId,
          discovery_origin: "blind_discovery",
          discovery_mode: lane,
          source_type: "account_independent_query",
          source_seed_id: plan.seed.id,
          source_theme: plan.seed.theme,
          source_language: plan.seed.language,
          run_id: plan.runId,
          collector_version: COLLECTOR_VERSION,
          author_followers: external.author_followers ?? null,
          metrics: external.metrics,
        };

        const receiptResult = await appendObservation(receipt);
        if (receiptResult === "created") receiptsCreated += 1;
        else receiptsReused += 1;

        await adminDb.collection("external_posts").doc(external.id).set(external, { merge: true });
        uniquePosts += 1;
      }
    }

    const completedAt = DateTime.utc().toISO()!;
    const finalBudget = await getRapidApiBudgetState();
    await runRef.set({
      status: "completed",
      top_result_count: counts.Top,
      latest_result_count: counts.Latest,
      unique_post_upserts: uniquePosts,
      observation_receipts_created: receiptsCreated,
      observation_receipts_reused: receiptsReused,
      budget: finalBudget,
      completed_at: completedAt,
      updated_at: completedAt,
    }, { merge: true });

    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      if (snapshot.get("lease_run_id") !== plan.runId) {
        throw new Error("Blind discovery lease changed before completion; refusing to advance the seed cursor.");
      }
      transaction.set(stateRef, {
        next_seed_index: plan.nextCursorIndex,
        last_completed_jst_date: jstDate,
        last_completed_run_id: plan.runId,
        lease_run_id: null,
        lease_until: null,
        updated_at: completedAt,
      }, { merge: true });
    });

    return {
      status: "completed",
      runId: plan.runId,
      seedId: plan.seed.id,
      query: plan.seed.query,
      topResults: counts.Top,
      latestResults: counts.Latest,
      uniquePosts,
      receiptsCreated,
      receiptsReused,
      budget: {
        month: finalBudget.month,
        count: finalBudget.count,
        remaining: finalBudget.remaining,
        budget: finalBudget.budget,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedAt = DateTime.utc().toISO()!;
    await runRef.set({
      status: "failed",
      error: message.slice(0, 1000),
      top_result_count: counts.Top,
      latest_result_count: counts.Latest,
      unique_post_upserts: uniquePosts,
      observation_receipts_created: receiptsCreated,
      observation_receipts_reused: receiptsReused,
      completed_at: failedAt,
      updated_at: failedAt,
    }, { merge: true });
    await releaseLease(stateRef, plan.runId);
    throw error;
  }
}


export interface BlindDiscoveryWorkItem {
  externalPostId: string;
  platformPostId: string;
  authorHandle: string;
  text: string;
  url: string;
  createdAt: string;
  fetchedAt: string;
  searchKeyword: string;
  discoveryQueryId: string;
  discoveryMode: "Top" | "Latest";
  authorFollowers: number | null;
  metrics: ExternalPostDoc["metrics"];
  sourceSeedId: string;
  sourceTheme: string;
  sourceLanguage: "ja" | "en";
  runId: string;
  receiptId: string;
}

/**
 * Read account-independent posts with their exact immutable acquisition proof.
 * The single-field fetched_at index keeps this bounded without introducing a
 * second acquisition collection or a compound-index dependency.
 */
export async function getBlindDiscoveryWork(
  limit = 40,
  maxAgeDays = 30,
): Promise<{ items: BlindDiscoveryWorkItem[]; scannedReceipts: number; asOf: string }> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const boundedAgeDays = Math.max(1, Math.min(Math.floor(maxAgeDays), 90));
  const now = DateTime.utc();
  const cutoff = now.minus({ days: boundedAgeDays }).toMillis();

  const snapshot = await adminDb
    .collection("external_post_observations")
    .orderBy("fetched_at", "desc")
    .limit(500)
    .get();

  const receipts = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as ExternalPostObservationDoc))
    .filter((receipt) =>
      receipt.discovery_origin === "blind_discovery" &&
      receipt.source_type === "account_independent_query" &&
      receipt.collector_version === COLLECTOR_VERSION &&
      typeof receipt.source_seed_id === "string" &&
      typeof receipt.source_theme === "string" &&
      (receipt.source_language === "ja" || receipt.source_language === "en") &&
      (receipt.discovery_mode === "Top" || receipt.discovery_mode === "Latest") &&
      Number.isFinite(Date.parse(receipt.fetched_at)) &&
      Date.parse(receipt.fetched_at) >= cutoff,
    )
    .sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at));

  const latestByPost = new Map<string, ExternalPostObservationDoc>();
  for (const receipt of receipts) {
    if (!latestByPost.has(receipt.external_post_id)) {
      latestByPost.set(receipt.external_post_id, receipt);
    }
  }

  const selected = Array.from(latestByPost.values()).slice(0, boundedLimit);
  const refs = selected.map((receipt) =>
    adminDb.collection("external_posts").doc(receipt.external_post_id),
  );
  const postSnapshots = refs.length ? await adminDb.getAll(...refs) : [];
  const postsById = new Map(
    postSnapshots
      .filter((post) => post.exists)
      .map((post) => [post.id, { id: post.id, ...post.data() } as ExternalPostDoc]),
  );

  const items: BlindDiscoveryWorkItem[] = [];
  for (const receipt of selected) {
    const post = postsById.get(receipt.external_post_id);
    if (!post || !post.text || !post.url) continue;
    if (
      hashBlindSourceText(post.text) !== receipt.text_hash ||
      post.platform_post_id !== receipt.platform_post_id ||
      post.author_handle?.trim().toLowerCase() !== receipt.author_handle.trim().toLowerCase() ||
      post.url !== receipt.canonical_url
    ) continue;
    if (receipt.discovery_mode !== "Top" && receipt.discovery_mode !== "Latest") continue;
    items.push({
      externalPostId: post.id,
      platformPostId: post.platform_post_id,
      authorHandle: receipt.author_handle,
      text: post.text,
      url: receipt.canonical_url,
      createdAt: receipt.created_at,
      fetchedAt: receipt.fetched_at,
      searchKeyword: receipt.search_keyword,
      discoveryQueryId: receipt.discovery_query_id,
      discoveryMode: receipt.discovery_mode,
      authorFollowers: receipt.author_followers ?? null,
      metrics: receipt.metrics,
      sourceSeedId: receipt.source_seed_id!,
      sourceTheme: receipt.source_theme!,
      sourceLanguage: receipt.source_language!,
      runId: receipt.run_id,
      receiptId: receipt.id,
    });
  }

  return {
    items,
    scannedReceipts: snapshot.size,
    asOf: now.toISO()!,
  };
}
