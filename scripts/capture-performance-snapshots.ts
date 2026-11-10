import { FieldPath } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { isPerformanceLearningEnabled } from "@/lib/account-gates";
import { fetchThreadsPostInsights } from "@/lib/platforms/threads";
import { buildPerformanceSnapshotUpdate } from "@/lib/performance-snapshots";
import { getAccounts } from "@/lib/services/firestore.server";
import type { AccountDoc, PostDoc, PerformanceWindow } from "@/lib/types";

const WINDOWS: Record<
  PerformanceWindow,
  { startAgeHours: number; endAgeHours: number }
> = {
  "24h": { startAgeHours: 24, endAgeHours: 30 },
  "72h": { startAgeHours: 72, endAgeHours: 78 },
};

// A short age-window query, not a historical collection scan. In normal use
// this is a small fraction of the post collection for the connected accounts.
const MAX_WRITES_PER_BATCH = 400;
const API_CONCURRENCY = 3;

type DuePost = {
  ref: FirebaseFirestore.DocumentReference;
  post: PostDoc;
  window: PerformanceWindow;
};

type SnapshotWrite = {
  ref: FirebaseFirestore.DocumentReference;
  window: PerformanceWindow;
  snapshot: NonNullable<PostDoc["performance_snapshots"]>["24h"];
};

async function fetchDuePosts(
  now: DateTime,
  window: PerformanceWindow,
): Promise<DuePost[]> {
  const bounds = WINDOWS[window];
  const from = now.minus({ hours: bounds.endAgeHours }).toISO()!;
  const until = now.minus({ hours: bounds.startAgeHours }).toISO()!;

  // created_at is the only queried field, so this uses Firestore's built-in
  // single-field index and does not require a composite-index deployment.
  const snapshot = await adminDb
    .collection("posts")
    .where("created_at", ">=", from)
    .where("created_at", "<", until)
    .orderBy("created_at", "asc")
    .get();

  return snapshot.docs.map((doc) => ({
    ref: doc.ref,
    post: { id: doc.id, ...doc.data() } as PostDoc,
    window,
  }));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await mapper(values[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

async function commitSnapshotWrites(writes: SnapshotWrite[]): Promise<number> {
  let committed = 0;

  // Firestore limits each batch to 500 operations. Keep headroom below that
  // ceiling, and only issue a commit when successful API responses produced
  // something to persist.
  for (let offset = 0; offset < writes.length; offset += MAX_WRITES_PER_BATCH) {
    const batch = adminDb.batch();
    const chunk = writes.slice(offset, offset + MAX_WRITES_PER_BATCH);

    for (const item of chunk) {
      batch.update(
        item.ref,
        new FieldPath("performance_snapshots", item.window),
        item.snapshot,
      );
    }

    await batch.commit();
    committed += chunk.length;
  }

  return committed;
}

async function main() {
  const now = DateTime.utc();
  const [allAccounts, due24h, due72h] = await Promise.all([
    getAccounts(),
    fetchDuePosts(now, "24h"),
    fetchDuePosts(now, "72h"),
  ]);

  const eligibleAccounts = new Map<string, AccountDoc>(
    allAccounts
      .filter(
        (account) =>
          account.platform === "threads" &&
          account.connected !== false &&
          isPerformanceLearningEnabled(account) &&
          Boolean(account.token_meta?.access_token) &&
          Boolean(account.token_meta?.user_id),
      )
      .map((account) => [account.id, account]),
  );

  const duePosts = [...due24h, ...due72h].filter(({ post, window }) => {
    if (post.platform !== "threads" || !eligibleAccounts.has(post.account_id)) {
      return false;
    }
    // Skip already-captured windows before making any Meta API call.
    return !post.performance_snapshots?.[window];
  });

  const counts = {
    due24h: due24h.length,
    due72h: due72h.length,
    eligible: duePosts.length,
    attempted: 0,
    captured24h: 0,
    captured72h: 0,
    missingViews: 0,
    failed: 0,
    written: 0,
  };

  const writes = await mapWithConcurrency(
    duePosts,
    API_CONCURRENCY,
    async ({ ref, post, window }): Promise<SnapshotWrite | null> => {
      const account = eligibleAccounts.get(post.account_id);
      if (!account) return null;

      counts.attempted += 1;
      try {
        const metrics = await fetchThreadsPostInsights(
          account,
          post.platform_post_id,
        );
        const snapshot = buildPerformanceSnapshotUpdate(
          post.created_at,
          metrics,
          "views",
          now.toJSDate(),
        )[window];

        // A boundary race or malformed timestamp should not be persisted as a
        // checkpoint for the wrong age. The next scheduled run can retry.
        if (!snapshot) return null;
        if (snapshot.metrics.impressions === null) counts.missingViews += 1;
        if (window === "24h") counts.captured24h += 1;
        else counts.captured72h += 1;

        return { ref, window, snapshot };
      } catch (error) {
        counts.failed += 1;
        const message =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `[PerformanceSnapshots] ${window} failed for ${post.id}: ${message}`,
        );
        return null;
      }
    },
  );

  const successfulWrites = writes.filter(
    (write): write is SnapshotWrite => write !== null,
  );
  counts.written = await commitSnapshotWrites(successfulWrites);

  console.log("[PerformanceSnapshots] Summary", JSON.stringify(counts, null, 2));

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      summaryPath,
      [
        "## Threads performance snapshots",
        "",
        `- Due posts (24h / 72h): ${counts.due24h} / ${counts.due72h}`,
        `- Eligible missing checkpoints: ${counts.eligible}`,
        `- Insights API requests: ${counts.attempted}`,
        `- Captured (24h / 72h): ${counts.captured24h} / ${counts.captured72h}`,
        `- Captured without Views value: ${counts.missingViews}`,
        `- Firestore documents written: ${counts.written}`,
        `- API failures: ${counts.failed}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  // A failed Insights request is visible to Actions and retried on the next
  // scheduled pass while its six-hour collection window remains open.
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[PerformanceSnapshots] Fatal error:", error);
  process.exit(1);
});
