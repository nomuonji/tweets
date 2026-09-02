import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { getCharacterVersion, belongsToCharacterVersion } from "@/lib/character-version";
import { fetchRecentThreadsPosts } from "@/lib/platforms/threads";
import type { AccountDoc, DraftDoc, PostDoc } from "@/lib/types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fullText(draft: DraftDoc): string {
  const hashtags = draft.hashtags?.length
    ? ` ${draft.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}`
    : "";
  return `${draft.text}${hashtags}`;
}

function isConfirmedMissingContainer(draft: DraftDoc): boolean {
  const message = draft.last_error?.message ?? "";
  return (
    message.includes('"code":24') &&
    message.includes('"error_subcode":4279009') &&
    message.includes("Media Not Found")
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const failed = await adminDb
    .collection("drafts")
    .where("status", "==", "failed")
    .get();
  const accountCache = new Map<string, AccountDoc>();
  const timelineCache = new Map<
    string,
    Awaited<ReturnType<typeof fetchRecentThreadsPosts>>["posts"]
  >();

  let requeueCount = 0;
  let reconciledCount = 0;
  let skippedCount = 0;

  for (const doc of failed.docs) {
    const draft = { ...doc.data(), id: doc.id } as DraftDoc;
    const accountId = draft.target_account_id;
    if (
      draft.target_platform !== "threads" ||
      !accountId ||
      !isConfirmedMissingContainer(draft)
    ) {
      skippedCount += 1;
      console.log(`[skip] ${doc.id}: failure is not a confirmed missing container`);
      continue;
    }

    let account = accountCache.get(accountId);
    if (!account) {
      const accountDoc = await adminDb.collection("accounts").doc(accountId).get();
      if (!accountDoc.exists) {
        skippedCount += 1;
        console.log(`[skip] ${doc.id}: account ${accountId} not found`);
        continue;
      }
      account = { id: accountDoc.id, ...accountDoc.data() } as AccountDoc;
      accountCache.set(accountId, account);
    }

    if (!belongsToCharacterVersion(draft, getCharacterVersion(account))) {
      skippedCount += 1;
      console.log(`[skip] ${doc.id}: draft belongs to an old character version`);
      continue;
    }

    let timeline = timelineCache.get(accountId);
    if (!timeline) {
      timeline = (await fetchRecentThreadsPosts(account, { limit: 100 })).posts;
      timelineCache.set(accountId, timeline);
    }

    const text = fullText(draft);
    const existing = timeline.find((post) => normalize(post.text) === normalize(text));
    if (existing) {
      reconciledCount += 1;
      console.log(
        `[reconcile] ${doc.id}: existing Threads post ${existing.platform_post_id}`,
      );
      if (!apply) continue;

      const postId = `threads_${existing.platform_post_id}`;
      const post: PostDoc = {
        id: postId,
        account_id: accountId,
        platform: "threads",
        platform_post_id: existing.platform_post_id,
        text: existing.text,
        created_at: existing.created_at,
        media_type: existing.media_type,
        has_url: existing.has_url,
        metrics: existing.metrics,
        score: 0,
        character_version: draft.character_version,
        ...(draft.pattern ? { pattern: draft.pattern } : {}),
        raw: { ...existing.raw, reconciled_from_failed_draft: doc.id },
        url: existing.url,
        fetched_at: new Date().toISOString(),
      };
      const batch = adminDb.batch();
      batch.set(adminDb.collection("posts").doc(postId), post, { merge: true });
      batch.delete(doc.ref);
      await batch.commit();
      continue;
    }

    requeueCount += 1;
    console.log(`[requeue] ${doc.id}: no matching visible post found`);
    if (!apply) continue;

    await doc.ref.update({
      status: "scheduled",
      updated_at: new Date().toISOString(),
      recovery_reason: "confirmed_missing_threads_media_container",
      recovered_at: new Date().toISOString(),
      publish_failure_count: 0,
      next_publish_attempt_at: null,
      publishing_started_at: FieldValue.delete(),
      publish_stage: FieldValue.delete(),
      publish_attempt_count: FieldValue.delete(),
      publish_creation_id: FieldValue.delete(),
      publish_stage_updated_at: FieldValue.delete(),
      last_error: FieldValue.delete(),
    });
  }

  console.log(
    `${apply ? "Applied" : "Dry run"}: ${requeueCount} requeue, ${reconciledCount} reconciled, ${skippedCount} skipped.`,
  );
  if (!apply) console.log("Re-run with --apply after reviewing this output.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
