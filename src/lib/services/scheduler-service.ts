import { DateTime } from "luxon";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc, AccountDoc, PostDoc } from "@/lib/types";
import { getAccounts } from "./firestore.server";
import { publishThreadsPost } from "@/lib/platforms/threads";
import { publishXPost } from "@/lib/platforms/x";

import { findDueSlots, selectSlot, SCHEDULE_TIMEZONE } from "./schedule-slots";

export { SCHEDULE_TIMEZONE };

/**
 * How late a slot may still be published. The scheduler runs on GitHub Actions,
 * whose cron is best-effort and frequently minutes-to-hours late, so a slot that
 * was missed should still go out — but posting a 07:00 slot at 18:00 is worse
 * than skipping it, hence the bound.
 */
const CATCHUP_GRACE_MINUTES = Number(
  process.env.SCHEDULER_CATCHUP_GRACE_MINUTES ?? 120,
);

/** A `publishing` lock older than this is assumed to be from a crashed run. */
const PUBLISHING_LOCK_TIMEOUT_MINUTES = 30;

function buildPostText(draft: DraftDoc) {
  const hashtags = draft.hashtags?.length
    ? ` ${draft.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}`
    : "";
  return `${draft.text}${hashtags}`;
}

async function publishDraft(draft: DraftDoc) {
  const accounts = await getAccounts();
  const account =
    accounts.find((item) => item.id === draft.target_account_id) ??
    accounts.find((item) => item.platform === draft.target_platform);

  if (!account) {
    throw new Error(`Account not found for draft ${draft.id}`);
  }

  if (draft.target_platform === "x") {
    return publishXPost(account, { text: buildPostText(draft) });
  }
  return publishThreadsPost(account, { text: buildPostText(draft) });
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

/** Oldest-first queue of drafts eligible for auto-posting. */
async function fetchNextDraft(accountId: string): Promise<DraftDoc | null> {
  try {
    const snapshot = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", accountId)
      .where("status", "in", ["scheduled", "draft"])
      .orderBy("created_at", "asc")
      .limit(1)
      .get();
    return snapshot.empty ? null : mapDraft(snapshot.docs[0]);
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
      .limit(50)
      .get();

    const candidates = snapshot.docs
      .map((doc) => mapDraft(doc))
      .filter(
        (draft) => draft.status === "scheduled" || draft.status === "draft",
      )
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

  const draft = await fetchNextDraft(accountId);
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

  // One slot triggers at most one publish attempt, success or failure, so a
  // failing draft cannot burn through the whole queue in a single window.
  await markSlotConsumed(accountId, targetSlot);

  try {
    const fullText = buildPostText(claimed);

    if (await hasDuplicatePost(accountId, fullText)) {
      console.warn(
        `[Scheduler] Skipping duplicate post for account ${accountId}: "${fullText.substring(0, 30)}..."`,
      );
      await adminDb.collection("drafts").doc(claimed.id).delete();
      return false;
    }

    const result = await publishDraft(claimed);
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
      raw: result.raw,
      url: result.url,
      fetched_at: nowStr,
    };

    const batch = adminDb.batch();
    batch.set(adminDb.collection("posts").doc(prefixedId), newPost);
    batch.delete(adminDb.collection("drafts").doc(claimed.id));
    await batch.commit();

    console.log(
      `[Scheduler] Published draft ${claimed.id} for slot ${targetSlot.toISO()} as ${result.platform_post_id}.`,
    );
    return true;
  } catch (error) {
    // Keep the draft. A publish failure is often transient (rate limit,
    // network, expired token) and deleting it would silently destroy the
    // user's content. Park it in `failed`: it is excluded from the draft query,
    // so it will not retry in a loop, and it stays visible on the dashboard.
    console.error(
      `[Scheduler] Failed to publish draft ${claimed.id} for account ${accountId}; marking as failed.`,
      error,
    );
    await adminDb
      .collection("drafts")
      .doc(claimed.id)
      .update({
        status: "failed",
        last_error: {
          message: (error as Error).message ?? String(error),
          occurred_at: DateTime.utc().toISO(),
        },
        updated_at: DateTime.utc().toISO(),
      });
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
