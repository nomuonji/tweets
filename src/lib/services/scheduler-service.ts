import { DateTime } from "luxon";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc } from "@/lib/types";
import { logEvent, getAccounts } from "./firestore.server";
import { publishThreadsPost } from "@/lib/platforms/threads";

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
    // return publishXPost(account, { text: buildPostText(draft) });
    throw new Error("Publishing to X is not yet implemented.");
  }
  return publishThreadsPost(account, { text: buildPostText(draft) });
}

export async function executeDueSchedules(now = DateTime.utc().toISO()) {
  const snapshot = await adminDb
    .collection("drafts")
    .where("status", "==", "scheduled")
    .where("schedule_time", "<=", now)
    .get();

  const drafts = snapshot.docs.map((doc) =>
    mapDraft(doc),
  );

  for (const draft of drafts) {
    try {
      const result = await publishDraft(draft);
      await adminDb.collection("drafts").doc(draft.id).set(
        {
          status: "published",
          published_at: DateTime.utc().toISO(),
          updated_at: DateTime.utc().toISO(),
          platform_post_id: result.platform_post_id,
        },
        { merge: true },
      );

      await logEvent({
        kind: "post",
        platform: draft.target_platform,
        account_id: draft.target_account_id ?? "unknown",
        detail: JSON.stringify({
          draft_id: draft.id,
          post_id: result.platform_post_id,
          url: result.url,
        }),
        created_at: DateTime.utc().toISO(),
      });
    } catch (error) {
      await logEvent({
        kind: "error",
        platform: draft.target_platform,
        account_id: draft.target_account_id ?? "unknown",
        detail: JSON.stringify({
          draft_id: draft.id,
          message: (error as Error).message,
          stack: (error as Error).stack,
        }),
        created_at: DateTime.utc().toISO(),
      });
    }
  }

  return drafts.length;
}

function mapDraft(doc: QueryDocumentSnapshot<DocumentData>): DraftDoc {
  const data = doc.data() as DraftDoc;
  return { ...data, id: doc.id };
}
