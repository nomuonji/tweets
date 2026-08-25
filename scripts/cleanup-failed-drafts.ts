import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc } from "@/lib/types";
import { recordPublishFailure } from "@/lib/services/scheduler-service";

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

  for (const doc of snapshot.docs) {
    await recordPublishFailure(
      { ...doc.data(), id: doc.id } as DraftDoc,
      new Error((doc.data() as DraftDoc).last_error?.message ?? "Unknown publish failure"),
      { deleteDraft: true },
    );
  }
  console.log(`Archived and removed ${snapshot.size} failed drafts.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
