import { adminDb } from "@/lib/firebase/admin";

async function main() {
  const apply = process.argv.includes("--apply");
  const snapshot = await adminDb
    .collection("drafts")
    .where("status", "==", "failed")
    .get();

  console.log(`Found ${snapshot.size} failed drafts.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to archive and remove them.");
    return;
  }

  const archivedAt = new Date().toISOString();
  for (const doc of snapshot.docs) {
    const batch = adminDb.batch();
    batch.set(adminDb.collection("failed_draft_archive").doc(doc.id), {
      ...doc.data(),
      id: doc.id,
      archived_at: archivedAt,
      archive_reason: "removed_from_active_queue_after_publish_failure",
    });
    batch.delete(doc.ref);
    await batch.commit();
  }
  console.log(`Archived and removed ${snapshot.size} failed drafts.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
