import { DateTime } from "luxon";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc, AccountDoc, PostDoc } from "@/lib/types";
import {
  classifyThreadsApiError,
  publishThreadsPost,
  reconcileThreadsPost,
  type ThreadsPublishProgress,
} from "@/lib/platforms/threads";
import { fetchRecentXPosts, publishXPost } from "@/lib/platforms/x";
import { linkAffiliatePostToProduct } from "./affiliate-tracking-service";

import { findDueSlots, selectSlot, SCHEDULE_TIMEZONE } from "./schedule-slots";
import {
  belongsToCharacterVersion,
  getCharacterVersion,
} from "@/lib/character-version";

export { SCHEDULE_TIMEZONE };

/**
 * How late a slot may still be published. The scheduler runs on GitHub Actions,
 * whose cron is best-effort and, in practice on this repo, has been observed
 * running 1–3h40m late despite a 15-minute schedule — a 2h grace window was
 * dropping slots that a slower-than-expected runner queue had merely delayed,
 * not genuinely missed. 6h covers that gap while still refusing to post a
 * morning slot in the evening.
 */
const CATCHUP_GRACE_MINUTES = Number(
  process.env.SCHEDULER_CATCHUP_GRACE_MINUTES ?? 360,
);

/** A `publishing` lock older than this is assumed to be from a crashed run. */
const PUBLISHING_LOCK_TIMEOUT_MINUTES = 30;
const RETRY_DELAY_MINUTES = 15;
const MAX_PUBLISH_FAILURES = 3;

/**
 * Axios throws with a generic "Request failed with status code 400"; the part
 * that actually says *why* lives in `response.data`. Without this the recorded
 * `last_error` is useless for diagnosis.
 */
export function describeError(error: unknown): string {
  const e = error as {
    message?: string;
    response?: { status?: number; data?: unknown };
  };

  if (e?.response) {
    const body =
      typeof e.response.data === "string"
        ? e.response.data
        : JSON.stringify(e.response.data);
    return `HTTP ${e.response.status ?? "?"}: ${body ?? "(empty body)"}`.slice(
      0,
      1500,
    );
  }

  return e?.message ?? String(error);
}

function buildPostText(draft: DraftDoc) {
  const hashtags = draft.hashtags?.length
    ? ` ${draft.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}`
    : "";
  return `${draft.text}${hashtags}`;
}

async function persistThreadsProgress(
  draftId: string,
  progress: ThreadsPublishProgress,
) {
  // Persist only the checkpoints needed after a crash. Omitting the two
  // transitional stages saves two Firestore writes per successful post.
  if (
    progress.stage !== "container_created" &&
    progress.stage !== "publishing" &&
    progress.stage !== "reconciling"
  ) {
    return;
  }
  await adminDb.collection("drafts").doc(draftId).update({
    publish_stage: progress.stage,
    publish_attempt_count: progress.attempt,
    publish_creation_id: progress.creationId ?? null,
    publish_stage_updated_at: DateTime.utc().toISO(),
  });
}

async function publishDraft(
  account: AccountDoc,
  draft: DraftDoc,
  startedAt: string,
) {
  if (draft.target_platform === "x") {
    await adminDb.collection("drafts").doc(draft.id).set({
      publish_stage: "publishing",
      publish_attempt_count: (draft.publish_attempt_count ?? 0) + 1,
      publish_stage_updated_at: DateTime.utc().toISO(),
    }, { merge: true });
    return publishXPost(account, { text: buildPostText(draft) });
  }
  return publishThreadsPost(
    account,
    { text: buildPostText(draft) },
    {
      startedAt,
      onProgress: (progress) => persistThreadsProgress(draft.id, progress),
    },
  );
}

async function reconcileXPublishedPost(account: AccountDoc, fullText: string, startedAt: string) {
  const recent = await fetchRecentXPosts(account, { startTime: startedAt, limit: 20 });
  const matched = recent.posts.find((post) => post.text.trim() === fullText.trim());
  if (!matched) return null;
  return { platform_post_id: matched.platform_post_id, url: matched.url, raw: matched.raw };
}

async function finalizePublishedPost(post: PostDoc, draft: DraftDoc, options: { scheduleSlot?: DateTime } = {}): Promise<PostDoc> {
  const now = DateTime.utc().toISO()!;
  const postRef = adminDb.collection("posts").doc(post.id);
  const draftRef = adminDb.collection("drafts").doc(draft.id);
  // Durable external-success fact. Later failures are reconciliation/cleanup only.
  await postRef.set(post, { merge: true });
  if (post.affiliate_product_id) {
    try { await linkAffiliatePostToProduct(post); }
    catch (error) { await postRef.set({ affiliate_link_status:"pending", affiliate_link_error:describeError(error), affiliate_link_updated_at:now }, { merge:true }); }
  }
  if (options.scheduleSlot) {
    try { await adminDb.collection("accounts").doc(post.account_id).update({ lastPostExecutedAt: options.scheduleSlot.toISO() }); }
    catch (error) {
      await postRef.set({ schedule_reconciliation_pending:true, affiliate_link_updated_at:now }, { merge:true }).catch(()=>undefined);
      await draftRef.set({ status:"scheduled", publishing_started_at:null, publish_stage:"reconciling", updated_at:now, last_error:{message:describeError(error),occurred_at:now} }, { merge:true }).catch(()=>undefined);
      const persisted=await postRef.get(); return { id:persisted.id, ...persisted.data() } as PostDoc;
    }
  }
  try { await draftRef.delete(); }
  catch {
    await draftRef.set({ status:"published", published_at:now, publishing_started_at:null, updated_at:now }, { merge:true }).catch(()=>undefined);
    await postRef.set({ publish_cleanup_pending:true }, { merge:true }).catch(()=>undefined);
  }
  const persisted=await postRef.get(); return { id:persisted.id, ...persisted.data() } as PostDoc;
}

export async function recordPublishFailure(
  draft: DraftDoc,
  error: unknown,
  options: { deleteDraft?: boolean; retryable?: boolean } = {},
): Promise<void> {
  const occurredAt = DateTime.utc().toISO()!;
  const failureCount = (draft.publish_failure_count ?? 0) + 1;
  const willRetry = options.retryable === true && failureCount < MAX_PUBLISH_FAILURES;
  const failureRef = adminDb.collection("publish_failures").doc();
  const draftRef = adminDb.collection("drafts").doc(draft.id);
  const batch = adminDb.batch();
  const threadsDetails =
    draft.target_platform === "threads"
      ? classifyThreadsApiError("publish", error)
      : null;

  batch.set(failureRef, {
    draft_id: draft.id,
    target_account_id: draft.target_account_id ?? null,
    target_platform: draft.target_platform,
    text: draft.text,
    message: describeError(error),
    occurred_at: occurredAt,
    failure_count: failureCount,
    will_retry: willRetry,
    ...(threadsDetails
      ? {
          error_stage: threadsDetails.stage,
          error_kind: threadsDetails.kind,
          http_status: threadsDetails.status ?? null,
          meta_code: threadsDetails.code ?? null,
          meta_subcode: threadsDetails.subcode ?? null,
        }
      : {}),
  });
  if (options.deleteDraft) {
    batch.delete(draftRef);
  } else {
    batch.update(draftRef, {
      status: willRetry ? "scheduled" : "failed",
      publishing_started_at: null,
      updated_at: occurredAt,
      publish_failure_count: failureCount,
      next_publish_attempt_at: willRetry
        ? DateTime.utc().plus({ minutes: RETRY_DELAY_MINUTES }).toISO()
        : null,
      last_error: {
        message: describeError(error),
        occurred_at: occurredAt,
      },
    });
  }
  await batch.commit();
}

export async function hasDuplicatePost(
  accountId: string,
  text: string,
): Promise<boolean> {
  const windowStart = DateTime.utc().minus({ hours: 24 }).toISO();
  let snapshot;
  try {
    snapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .where("created_at", ">", windowStart)
      .get();
  } catch (error) {
    // If the composite index is missing, fall back to fetching recent posts
    // and filtering the time window in memory.
    console.warn(
      `[Scheduler] Duplicate-check query failed for account ${accountId}; falling back to in-memory filter.`,
      error,
    );
    const fallbackSnapshot = await adminDb
      .collection("posts")
      .where("account_id", "==", accountId)
      .orderBy("created_at", "desc")
      .limit(30)
      .get();

    return fallbackSnapshot.docs.some((doc) => {
      const data = doc.data() as PostDoc;
      if (data.created_at < windowStart) return false;
      return data.text === text;
    });
  }

  return snapshot.docs.some((doc) => (doc.data() as PostDoc).text === text);
}

async function markSlotConsumed(accountId: string, slot: DateTime) {
  await adminDb
    .collection("accounts")
    .doc(accountId)
    .update({ lastPostExecutedAt: slot.toISO() });
}

/**
 * Return drafts abandoned mid-publish (crashed run, cancelled Action) to the
 * queue. `fetchNextDraft` only looks at draft/scheduled, so without this pass a
 * stuck `publishing` doc is invisible forever and its content is stranded.
 */
async function reclaimStalePublishing(accountId: string, now: DateTime) {
  const snapshot = await adminDb
    .collection("drafts")
    .where("target_account_id", "==", accountId)
    .where("status", "==", "publishing")
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data() as DraftDoc;
    const startedAt = data.publishing_started_at
      ? DateTime.fromISO(data.publishing_started_at)
      : null;
    const isStale =
      !startedAt ||
      !startedAt.isValid ||
      now.diff(startedAt, "minutes").minutes > PUBLISHING_LOCK_TIMEOUT_MINUTES;

    if (!isStale) continue;

    console.warn(
      `[Scheduler] Returning stranded draft ${doc.id} from publishing to draft.`,
    );
    await doc.ref.update({
      status: "draft",
      updated_at: DateTime.utc().toISO(),
    });
  }
}

/** Oldest-first queue of drafts eligible for auto-posting. */
async function fetchNextDraft(
  accountId: string,
  characterVersion: number,
): Promise<DraftDoc | null> {
  try {
    const snapshot = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", accountId)
      .where("status", "in", ["scheduled", "draft"])
      .orderBy("created_at", "asc")
      .get();
    const now = DateTime.utc();
    const candidate = snapshot.docs
      .map((doc) => mapDraft(doc))
      .filter((draft) => {
        if (!draft.next_publish_attempt_at) return true;
        const retryAt = DateTime.fromISO(draft.next_publish_attempt_at);
        return !retryAt.isValid || retryAt <= now;
      })
      .find((draft) => belongsToCharacterVersion(draft, characterVersion));
    return candidate ?? null;
  } catch (error) {
    // The `status in [...] + orderBy` combination needs a composite index. If it
    // is missing, fall back to an unordered scan rather than failing the run.
    console.warn(
      `[Scheduler] Draft query failed for account ${accountId}; falling back to in-memory selection.`,
      error,
    );
    const snapshot = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", accountId)
      .limit(20)
      .get();

    const candidates = snapshot.docs
      .map((doc) => mapDraft(doc))
      .filter(
        (draft) => draft.status === "scheduled" || draft.status === "draft",
      )
      .filter((draft) => belongsToCharacterVersion(draft, characterVersion))
      .filter((draft) => {
        if (!draft.next_publish_attempt_at) return true;
        const retryAt = DateTime.fromISO(draft.next_publish_attempt_at);
        return !retryAt.isValid || retryAt <= DateTime.utc();
      })
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

    return candidates[0] ?? null;
  }
}

/**
 * Claim the draft by moving it to `publishing`. Returns null when another run
 * already holds a fresh lock. Stale locks (from a crashed run) are reclaimed.
 */
async function claimDraft(
  draftId: string,
  now: DateTime,
): Promise<DraftDoc | null> {
  const docRef = adminDb.collection("drafts").doc(draftId);

  return adminDb.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) return null;

    const data = doc.data() as DraftDoc;

    if (data.status === "published") return null;

    if (data.status === "publishing") {
      const startedAt = data.publishing_started_at
        ? DateTime.fromISO(data.publishing_started_at)
        : null;
      const isStale =
        !startedAt ||
        !startedAt.isValid ||
        now.diff(startedAt, "minutes").minutes >
          PUBLISHING_LOCK_TIMEOUT_MINUTES;

      if (!isStale) return null;
      console.warn(
        `[Scheduler] Reclaiming stale publishing lock on draft ${draftId}.`,
      );
    }

    transaction.update(docRef, {
      status: "publishing",
      publishing_started_at: now.toISO(),
      next_publish_attempt_at: null,
    });
    return { ...data, id: doc.id } as DraftDoc;
  });
}

async function processAccount(
  account: AccountDoc,
  now: DateTime,
): Promise<
  | "published"
  | "duplicate"
  | "not_due"
  | "stale_skipped"
  | "no_draft"
  | "locked"
  | "failed"
> {
  const { postSchedule, id: accountId } = account;
  if (!postSchedule || postSchedule.length === 0) return "not_due";

  const lastExecutedAt = account.lastPostExecutedAt
    ? DateTime.fromISO(account.lastPostExecutedAt).setZone(SCHEDULE_TIMEZONE)
    : null;

  const dueSlots = findDueSlots(
    postSchedule,
    now,
    lastExecutedAt?.isValid ? lastExecutedAt : null,
  );
  const decision = selectSlot(dueSlots, now, CATCHUP_GRACE_MINUTES);

  if (decision.action === "none") return "not_due";

  if (decision.action === "skip") {
    console.log(
      `[Scheduler] Account ${accountId}: skipping ${dueSlots.length} stale slot(s) older than ${CATCHUP_GRACE_MINUTES}min (through ${decision.consumeThrough.toISO()}).`,
    );
    await markSlotConsumed(accountId, decision.consumeThrough);
    return "stale_skipped";
  }

  const targetSlot = decision.slot;

  await reclaimStalePublishing(accountId, now);

  const characterVersion = getCharacterVersion(account);
  const draft = await fetchNextDraft(accountId, characterVersion);
  if (!draft) {
    console.log(
      `[Scheduler] Account ${accountId}: slot ${targetSlot.toISO()} is due but no draft is available.`,
    );
    // Do not consume the slot — a draft created shortly after should still be
    // able to fill it while it is within the grace window.
    return "no_draft";
  }

  const claimed = await claimDraft(draft.id, now);
  if (!claimed) {
    console.log(
      `[Scheduler] Draft ${draft.id} is locked by another run; skipping.`,
    );
    return "locked";
  }

  try {
    const fullText = buildPostText(claimed);

    if (await hasDuplicatePost(accountId, fullText)) {
      console.warn(
        `[Scheduler] Skipping duplicate post for account ${accountId}: "${fullText.substring(0, 30)}..."`,
      );
      const batch = adminDb.batch();
      batch.delete(adminDb.collection("drafts").doc(claimed.id));
      batch.update(adminDb.collection("accounts").doc(accountId), {
        lastPostExecutedAt: targetSlot.toISO(),
      });
      await batch.commit();
      return "duplicate";
    }

    const startedAt = claimed.publishing_started_at ?? now.toUTC().toISO()!;
    let result = null;

    // Reconcile an ambiguous previous platform publish before any retry.
    if (claimed.publish_stage === "publishing" || claimed.publish_stage === "reconciling") {
      result = claimed.target_platform === "threads"
        ? await reconcileThreadsPost(account, fullText, startedAt)
        : await reconcileXPublishedPost(account, fullText, startedAt);
      if (result) console.log(`[Scheduler] Reconciled draft ${claimed.id} with existing ${claimed.target_platform} post ${result.platform_post_id}.`);
    }

    result ??= await publishDraft(account, claimed, startedAt);
    const nowStr = now.toISO() ?? DateTime.utc().toISO()!;
    const prefixedId = `${claimed.target_platform}_${result.platform_post_id}`;

    const newPost: PostDoc = {
      id: prefixedId,
      account_id: accountId,
      platform: claimed.target_platform,
      platform_post_id: result.platform_post_id,
      text: fullText,
      created_at: nowStr,
      media_type: "text",
      has_url: fullText.includes("http"),
      metrics: {
        impressions: 0,
        likes: 0,
        replies: 0,
        reposts_or_rethreads: 0,
        quotes: 0,
        link_clicks: null,
      },
      score: 0,
      character_version: claimed.character_version ?? characterVersion,
      ...(claimed.pattern ? { pattern: claimed.pattern } : {}),
      raw: result.raw,
      url: result.url,
      fetched_at: nowStr,
      source_draft_id: claimed.id,
      ...(claimed.owned_content_item_id ? {
        owned_content_item_id: claimed.owned_content_item_id,
        owned_content_source_id: claimed.owned_content_source_id,
        owned_content_url: claimed.owned_content_url,
        owned_content_source_type: claimed.owned_content_source_type,
      } : {}),
      ...(claimed.affiliate_product_id ? { affiliate_product_id:claimed.affiliate_product_id, ...(claimed.affiliate_creative_id ? { affiliate_creative_id:claimed.affiliate_creative_id } : {}), affiliate_link_status:"pending" as const } : {}),
    };

    await finalizePublishedPost(newPost, claimed, { scheduleSlot: targetSlot });

    console.log(
      `[Scheduler] Published draft ${claimed.id} for slot ${targetSlot.toISO()} as ${result.platform_post_id}.`,
    );
    return "published";
  } catch (error) {
    // Keep the draft and leave the slot unconsumed. A later draft can fill the
    // slot after the failure is inspected, while the failed content remains
    // visible and recoverable on the dashboard.
    console.error(
      `[Scheduler] Failed to publish draft ${claimed.id} for account ${accountId}; marking as failed.`,
      error,
    );
    const threadsFailure = claimed.target_platform === "threads" ? classifyThreadsApiError("publish", error) : null;
    const currentAfterFailure = await adminDb.collection("drafts").doc(claimed.id).get().catch(() => null);
    const currentDraft = currentAfterFailure?.exists ? ({ id:currentAfterFailure.id, ...currentAfterFailure.data() } as DraftDoc) : claimed;
    const hasPublishCheckpoint = currentDraft.publish_stage === "publishing" || currentDraft.publish_stage === "reconciling";
    const retryable = hasPublishCheckpoint || threadsFailure?.kind === "media_not_found" || threadsFailure?.kind === "rate_limited" || threadsFailure?.kind === "transient" || threadsFailure?.kind === "ambiguous_publish";
    await recordPublishFailure(currentDraft, error, { retryable });
    return "failed";
  }
}

/** Publish exactly one already-saved draft. Used by the dashboard and MCP; it
 * shares the scheduler's lock, duplicate guard, recovery and persistence path. */
export async function publishExistingDraft(draftId: string, expectedUpdatedAt: string): Promise<PostDoc> {
  const ref=adminDb.collection("drafts").doc(draftId); const before=await ref.get();
  if(!before.exists) throw new Error("Draft not found.");
  if(before.data()?.updated_at!==expectedUpdatedAt) throw new Error("updated_at conflict: refresh and retry.");
  const existingPost=await adminDb.collection("posts").where("source_draft_id","==",draftId).limit(1).get();
  if(!existingPost.empty){const doc=existingPost.docs[0]; await ref.delete().catch(()=>ref.set({status:"published",published_at:DateTime.utc().toISO()},{merge:true})); return {id:doc.id,...doc.data()} as PostDoc;}
  const now=DateTime.utc(); const claimed=await claimDraft(draftId,now); if(!claimed) throw new Error("Draft is currently locked or already published.");
  const accountId=claimed.target_account_id; if(!accountId) throw new Error("Draft has no target account.");
  const accountSnap=await adminDb.collection("accounts").doc(accountId).get(); if(!accountSnap.exists) throw new Error("Account not found.");
  const account={id:accountSnap.id,...accountSnap.data()} as AccountDoc; const version=getCharacterVersion(account);
  if(!belongsToCharacterVersion(claimed,version)){await ref.update({status:"scheduled",publishing_started_at:null,updated_at:DateTime.utc().toISO()}); throw new Error("Draft uses an old character version.");}
  try {
    const fullText=buildPostText(claimed); if(await hasDuplicatePost(accountId,fullText)){await ref.delete(); throw new Error("A matching post was already published in the last 24 hours.");}
    const startedAt=claimed.publishing_started_at??now.toISO()!; let result=null;
    if(claimed.publish_stage==="publishing"||claimed.publish_stage==="reconciling") result=claimed.target_platform==="threads"?await reconcileThreadsPost(account,fullText,startedAt):await reconcileXPublishedPost(account,fullText,startedAt);
    result??=await publishDraft(account,claimed,startedAt);
    const nowStr=DateTime.utc().toISO()!, id=claimed.target_platform+"_"+result.platform_post_id;
    const post:PostDoc={id,account_id:accountId,platform:claimed.target_platform,platform_post_id:result.platform_post_id,text:fullText,created_at:nowStr,media_type:"text",has_url:fullText.includes("http"),metrics:{impressions:0,likes:0,replies:0,reposts_or_rethreads:0,quotes:0,link_clicks:null},score:0,character_version:claimed.character_version??version,...(claimed.pattern?{pattern:claimed.pattern}:{}),raw:result.raw,url:result.url,fetched_at:nowStr,source_draft_id:claimed.id,...(claimed.owned_content_item_id?{owned_content_item_id:claimed.owned_content_item_id,owned_content_source_id:claimed.owned_content_source_id,owned_content_url:claimed.owned_content_url,owned_content_source_type:claimed.owned_content_source_type}:{}),...(claimed.affiliate_product_id?{affiliate_product_id:claimed.affiliate_product_id,...(claimed.affiliate_creative_id?{affiliate_creative_id:claimed.affiliate_creative_id}:{}),affiliate_link_status:"pending" as const}:{})};
    return await finalizePublishedPost(post,claimed);
  } catch(error) {
    const current=await ref.get().catch(()=>null); if(current?.exists){const currentDraft={id:current.id,...current.data()} as DraftDoc; const retryable=currentDraft.publish_stage==="publishing"||currentDraft.publish_stage==="reconciling"||claimed.target_platform==="threads"; await recordPublishFailure(currentDraft,error,{retryable});}
    throw error;
  }
}

export interface ScheduleExecutionResult {
  publishedCount: number;
  duplicateCount: number;
  staleSkippedCount: number;
  noDraftAccountIds: string[];
  lockedAccountIds: string[];
  failedAccountIds: string[];
}

export async function executeDueSchedules(
  nowIso: string | null = DateTime.utc().toISO(),
): Promise<ScheduleExecutionResult> {
  const now = DateTime.fromISO(nowIso ?? DateTime.utc().toISO()!).setZone(
    SCHEDULE_TIMEZONE,
  );
  const result: ScheduleExecutionResult = {
    publishedCount: 0,
    duplicateCount: 0,
    staleSkippedCount: 0,
    noDraftAccountIds: [],
    lockedAccountIds: [],
    failedAccountIds: [],
  };

  const accountsSnapshot = await adminDb
    .collection("accounts")
    .where("autoPostEnabled", "==", true)
    .get();

  if (accountsSnapshot.empty) {
    console.log("[Scheduler] No accounts with auto-post enabled.");
    return result;
  }

  const accounts = accountsSnapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as AccountDoc,
  );

  for (const account of accounts) {
    // Isolate failures per account: previously one thrown error aborted the
    // whole run and every remaining account was skipped for that cycle.
    try {
      const outcome = await processAccount(account, now);
      if (outcome === "published") result.publishedCount++;
      if (outcome === "duplicate") result.duplicateCount++;
      if (outcome === "stale_skipped") result.staleSkippedCount++;
      if (outcome === "no_draft") result.noDraftAccountIds.push(account.id);
      if (outcome === "locked") result.lockedAccountIds.push(account.id);
      if (outcome === "failed") result.failedAccountIds.push(account.id);
    } catch (error) {
      console.error(
        `[Scheduler] Unhandled error while processing account ${account.id}.`,
        error,
      );
      result.failedAccountIds.push(account.id);
    }
  }

  return result;
}

function mapDraft(doc: QueryDocumentSnapshot<DocumentData>): DraftDoc {
  const data = doc.data() as DraftDoc;
  return { ...data, id: doc.id };
}
