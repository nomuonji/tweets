import { DateTime } from "luxon";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc, AccountDoc, PostDoc } from "@/lib/types";
import { publishThreadsPost } from "@/lib/platforms/threads";
import { publishXPost } from "@/lib/platforms/x";

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

async function publishDraft(account: AccountDoc, draft: DraftDoc) {
  if (draft.target_platform === "x") {
    return publishXPost(account, { text: buildPostText(draft) });
  }
  return publishThreadsPost(account, { text: buildPostText(draft) });
}

export async function recordPublishFailure(
  draft: DraftDoc,
  error: unknown,
  options: { deleteDraft?: boolean } = {},
): Promise<void> {
  const occurredAt = DateTime.utc().toISO()!;
  const failureRef = adminDb.collection("publish_failures").doc();
  const draftRef = adminDb.collection("drafts").doc(draft.id);
  const batch = adminDb.batch();

  batch.set(failureRef, {
    draft_id: draft.id,
    target_account_id: draft.target_account_id ?? null,
    target_platform: draft.target_platform,
    text: draft.text,
    message: describeError(error),
    occurred_at: occurredAt,
  });
  if (options.deleteDraft) {
    batch.delete(draftRef);
  } else {
    batch.update(draftRef, {
      status: "failed",
      publishing_started_at: null,
      updated_at: occurredAt,
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
    const candidate = snapshot.docs
      .map((doc) => mapDraft(doc))
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
    });
    return { ...data, id: doc.id } as DraftDoc;
  });
}

async function processAccount(
  account: AccountDoc,
  now: DateTime,
): Promise<boolean> {
  const { postSchedule, id: accountId } = account;
  if (!postSchedule || postSchedule.length === 0) return false;

  const lastExecutedAt = account.lastPostExecutedAt
    ? DateTime.fromISO(account.lastPostExecutedAt).setZone(SCHEDULE_TIMEZONE)
    : null;

  const dueSlots = findDueSlots(
    postSchedule,
    now,
    lastExecutedAt?.isValid ? lastExecutedAt : null,
  );
  const decision = selectSlot(dueSlots, now, CATCHUP_GRACE_MINUTES);

  if (decision.action === "none") return false;

  if (decision.action === "skip") {
    console.log(
      `[Scheduler] Account ${accountId}: skipping ${dueSlots.length} stale slot(s) older than ${CATCHUP_GRACE_MINUTES}min (through ${decision.consumeThrough.toISO()}).`,
    );
    await markSlotConsumed(accountId, decision.consumeThrough);
    return false;
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
    return false;
  }

  const claimed = await claimDraft(draft.id, now);
  if (!claimed) {
    console.log(
      `[Scheduler] Draft ${draft.id} is locked by another run; skipping.`,
    );
    return false;
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
      return false;
    }

    const result = await publishDraft(account, claimed);
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
        link_clicks: 0,
      },
      score: 0,
      character_version: claimed.character_version ?? characterVersion,
      pattern: claimed.pattern,
      raw: result.raw,
      url: result.url,
      fetched_at: nowStr,
    };

    const batch = adminDb.batch();
    batch.set(adminDb.collection("posts").doc(prefixedId), newPost);
    batch.delete(adminDb.collection("drafts").doc(claimed.id));
    batch.update(adminDb.collection("accounts").doc(accountId), {
      lastPostExecutedAt: targetSlot.toISO(),
    });
    await batch.commit();

    console.log(
      `[Scheduler] Published draft ${claimed.id} for slot ${targetSlot.toISO()} as ${result.platform_post_id}.`,
    );
    return true;
  } catch (error) {
    // Keep the draft and leave the slot unconsumed. A later draft can fill the
    // slot after the failure is inspected, while the failed content remains
    // visible and recoverable on the dashboard.
    console.error(
      `[Scheduler] Failed to publish draft ${claimed.id} for account ${accountId}; marking as failed.`,
      error,
    );
    await recordPublishFailure(claimed, error);
    return false;
  }
}

export async function executeDueSchedules(
  nowIso: string | null = DateTime.utc().toISO(),
) {
  const now = DateTime.fromISO(nowIso ?? DateTime.utc().toISO()!).setZone(
    SCHEDULE_TIMEZONE,
  );
  let publishedCount = 0;

  const accountsSnapshot = await adminDb
    .collection("accounts")
    .where("autoPostEnabled", "==", true)
    .get();

  if (accountsSnapshot.empty) {
    console.log("[Scheduler] No accounts with auto-post enabled.");
    return 0;
  }

  const accounts = accountsSnapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as AccountDoc,
  );

  for (const account of accounts) {
    // Isolate failures per account: previously one thrown error aborted the
    // whole run and every remaining account was skipped for that cycle.
    try {
      if (await processAccount(account, now)) publishedCount++;
    } catch (error) {
      console.error(
        `[Scheduler] Unhandled error while processing account ${account.id}.`,
        error,
      );
    }
  }

  return publishedCount;
}

function mapDraft(doc: QueryDocumentSnapshot<DocumentData>): DraftDoc {
  const data = doc.data() as DraftDoc;
  return { ...data, id: doc.id };
}
