import { DateTime } from "luxon";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc, AccountDoc } from "@/lib/types";
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

export async function executeDueSchedules(nowIso = DateTime.now().setZone('Asia/Tokyo').toISO()) {
  const now = DateTime.fromISO(nowIso).setZone('Asia/Tokyo');
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
      await adminDb.collection("drafts").doc(draft.id).set(
        { 
          status: "published", 
          published_at: now.toISO(), 
          updated_at: now.toISO(),
          platform_post_id: result.platform_post_id, 
          url: result.url 
        },
        { merge: true },
      );
      
      publishedCount++;
      console.log(`[Scheduler] Published draft ${draft.id} for account ${accountId}.`);
    } catch (error) {
      console.error(`[Scheduler] Failed to process draft ${draft.id} for account ${accountId}.`, error);
      await adminDb.collection("drafts").doc(draft.id).set({ status: "error", updated_at: now.toISO() }, { merge: true });
    }
  }

  return publishedCount;
}

function mapDraft(doc: QueryDocumentSnapshot<DocumentData>): DraftDoc {
  const data = doc.data() as DraftDoc;
  return { ...data, id: doc.id };
}
