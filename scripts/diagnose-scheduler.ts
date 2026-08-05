/**
 * Read-only health check for auto-posting. Publishes nothing.
 *
 * Answers "why isn't it posting?" in one shot: which accounts are enabled,
 * whether they have publishable drafts, and what the actual publish errors were.
 *
 *   npm run diagnose:scheduler
 */
import { adminDb } from "@/lib/firebase/admin";
import type { DraftDoc } from "@/lib/types";
import "dotenv/config";

async function main() {
  const accountsSnap = await adminDb
    .collection("accounts")
    .where("autoPostEnabled", "==", true)
    .get();

  console.log(`=== auto-post accounts: ${accountsSnap.size} ===\n`);

  for (const doc of accountsSnap.docs) {
    const a = doc.data();

    const draftsSnap = await adminDb
      .collection("drafts")
      .where("target_account_id", "==", doc.id)
      .get();

    const byStatus: Record<string, number> = {};
    for (const d of draftsSnap.docs) {
      const status = String((d.data() as DraftDoc).status ?? "(undefined)");
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }

    const publishable =
      (byStatus["draft"] ?? 0) + (byStatus["scheduled"] ?? 0);

    console.log(`${doc.id}`);
    console.log(`  schedule   : ${JSON.stringify(a.postSchedule ?? [])}`);
    console.log(`  lastExec   : ${a.lastPostExecutedAt ?? "-"}`);
    console.log(
      `  drafts     : ${draftsSnap.size} total, ${publishable} publishable ${JSON.stringify(byStatus)}`,
    );
    if (publishable === 0) {
      console.log(`  >> NOTHING TO POST for this account`);
    }
    console.log("");
  }

  const failedSnap = await adminDb
    .collection("drafts")
    .where("status", "==", "failed")
    .get();

  console.log(`=== failed drafts: ${failedSnap.size} ===`);

  const grouped = new Map<string, { count: number; latest: string }>();
  for (const doc of failedSnap.docs) {
    const d = doc.data() as DraftDoc;
    const msg = d.last_error?.message ?? "(no error recorded)";
    const when = d.last_error?.occurred_at ?? "-";
    const prev = grouped.get(msg);
    if (prev) {
      prev.count++;
      if (when > prev.latest) prev.latest = when;
    } else {
      grouped.set(msg, { count: 1, latest: when });
    }
  }

  const rows = Array.from(grouped.entries()).sort(
    (a, b) => b[1].count - a[1].count,
  );
  for (const [msg, info] of rows) {
    console.log(`\n  [${info.count}x] latest ${info.latest}`);
    console.log(`  ${msg}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
