import { DateTime } from "luxon";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc, AccountDoc, PostDoc } from "@/lib/types";
import { getAccounts } from "./firestore.server";
import { publishThreadsPost } from "@/lib/platforms/threads";
import { publishXPost } from "@/lib/platforms/x";

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

export async function executeDueSchedules(nowIso: string | null = DateTime.utc().toISO()) {
  const now = DateTime.fromISO(nowIso ?? DateTime.utc().toISO()!).setZone('Asia/Tokyo');
  const windowStart = now.minus({ minutes: 59 });
  let publishedCount = 0;

  const accountsSnapshot = await adminDb
    .collection("accounts")
    .where("autoPostEnabled", "==", true)
    .get();

  if (accountsSnapshot.empty) {
    console.log("[Scheduler] No accounts with auto-post enabled.");
    return 0;
  }

  const accounts = accountsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountDoc));

  for (const account of accounts) {
    const { postSchedule, id: accountId } = account;
    if (!postSchedule || postSchedule.length === 0) {
      continue;
    }

    // Find the earliest schedule that falls within the last 59 minutes
    const dueSchedule = postSchedule
      .map(timeStr => {
        const [hour, minute] = timeStr.split(':').map(Number);
        // Create a datetime for today with the schedule's time
        return now.set({ hour, minute, second: 0, millisecond: 0 });
      })
      .filter(scheduleTime => scheduleTime > windowStart && scheduleTime <= now)
      .sort((a, b) => a.toMillis() - b.toMillis())
      [0];

    if (!dueSchedule) {
      continue; // No schedule due for this account in this window
    }

    const draftsSnapshot = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", accountId)
      .where("status", "in", ["scheduled", "draft"])
      .orderBy("created_at", "asc")
      .limit(1)
      .get();

    if (draftsSnapshot.empty) {
      continue;
    }

    const draft = mapDraft(draftsSnapshot.docs[0]);

    try {
      const result = await publishDraft(draft);
      const nowStr = now.toISO() ?? DateTime.utc().toISO()!;

      const prefixedId = `${draft.target_platform}_${result.platform_post_id}`;

      const newPost: PostDoc = {
        id: prefixedId,
        account_id: accountId,
        platform: draft.target_platform,
        platform_post_id: result.platform_post_id,
        text: buildPostText(draft),
        created_at: nowStr, // This should ideally be from the platform, but using server time for now.
        media_type: "text", // Assuming text for now
        has_url: buildPostText(draft).includes("http"),
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
      const postRef = adminDb.collection("posts").doc(prefixedId);
      const draftRef = adminDb.collection("drafts").doc(draft.id);

      batch.set(postRef, newPost);
      batch.delete(draftRef);

      await batch.commit();

      publishedCount++;
      console.log(`[Scheduler] Published draft ${draft.id} and moved to posts as ${result.platform_post_id}.`);
    } catch (error) {
      console.error(`[Scheduler] Failed to process draft ${draft.id} for account ${accountId}.`, error);
      console.log(`[Scheduler] Deleting failed draft ${draft.id}.`);
      const draftRef = adminDb.collection("drafts").doc(draft.id);
      await draftRef.delete();
    }
  }

  return publishedCount;
}

function mapDraft(doc: QueryDocumentSnapshot<DocumentData>): DraftDoc {
  const data = doc.data() as DraftDoc;
  return { ...data, id: doc.id };
}
