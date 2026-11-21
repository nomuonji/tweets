import { FieldValue } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { belongsToCharacterVersion, getCharacterVersion } from "@/lib/character-version";
import { isPerformanceLearningEnabled } from "@/lib/account-gates";
import { adminDb } from "@/lib/firebase/admin";
import { computePatternAnalysis } from "@/lib/pattern";
import { selectAgeMatchedCohort } from "@/lib/performance-cohorts";
import { getAccounts } from "@/lib/services/firestore.server";
import type { PostDoc } from "@/lib/types";

const LOOKBACK_DAYS = 30;
const MIN_POSTS = 5;

async function fetchRecentPostsForAccount(accountId: string): Promise<PostDoc[]> {
  const start = DateTime.utc().minus({ days: LOOKBACK_DAYS }).toISO()!;
  const snapshot = await adminDb
    .collection("posts")
    .where("account_id", "==", accountId)
    .where("created_at", ">=", start)
    .get();

  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as PostDoc,
  );
}

async function main() {
  const accounts = (await getAccounts()).filter(
    (account) =>
      account.platform === "threads" &&
      account.connected !== false &&
      isPerformanceLearningEnabled(account),
  );

  let updated = 0;
  let skipped = 0;

  for (const account of accounts) {
    try {
      const characterVersion = getCharacterVersion(account);
      const posts = await fetchRecentPostsForAccount(account.id);
      const cohort = selectAgeMatchedCohort(posts, characterVersion);

      if (!cohort || cohort.posts.length < MIN_POSTS) {
        console.log(
          `[LegacyCohort] ${account.handle ?? account.id}: ${cohort?.posts.length ?? 0} usable age-matched posts (48h=${cohort?.counts["48h"] ?? 0}, 72h=${cohort?.counts["72h"] ?? 0}); keeping existing analysis.`,
        );
        skipped += 1;
        continue;
      }

      const analysis = computePatternAnalysis(
        cohort.posts.map((post) => ({
          text: post.text,
          metrics: post.metrics,
        })),
        account.id,
        cohort.measurementWindow,
        "views",
      );
      analysis.character_version = characterVersion;
      analysis.measurementBasis = cohort.measurementBasis;
      analysis.cohortAgeHours = cohort.cohortAgeHours;

      // A valid fixed-age 72h sample has stronger timing evidence than a
      // fetched-at approximate cohort. The two GitHub workflows can race on
      // the same push, so precedence must be enforced at commit time.
      const exact72Count = posts.filter((post) => {
        if (!belongsToCharacterVersion(post, characterVersion)) return false;
        const snapshot = post.performance_snapshots?.["72h"];
        return Boolean(
          snapshot &&
          snapshot.age_hours >= 72 &&
          snapshot.age_hours < 78 &&
          typeof snapshot.metrics.impressions === "number" &&
          Number.isFinite(snapshot.metrics.impressions) &&
          snapshot.metrics.impressions > 0,
        );
      }).length;

      let preservedExact = false;
      const statsRef = adminDb.collection("pattern_stats").doc(account.id);
      await adminDb.runTransaction(async (transaction) => {
        const current = (await transaction.get(statsRef)).data();
        if (
          exact72Count >= MIN_POSTS &&
          current?.measurementBasis === "fixed_age_snapshot" &&
          current?.measurementWindow === "72h" &&
          current?.character_version === characterVersion &&
          typeof current?.analyzedPosts === "number" &&
          current.analyzedPosts >= MIN_POSTS
        ) {
          preservedExact = true;
          return;
        }

        // Legacy remains a fallback when no current-version fixed-age result
        // exists. Transaction retries guard against a concurrent exact write.
        transaction.set(
          statsRef,
          {
            ...analysis,
            content_insights: FieldValue.delete(),
            cohortSelectionCounts: cohort.counts,
          },
          { merge: true },
        );
      });
      if (preservedExact) {
        console.log(
          `[LegacyCohort] ${account.handle ?? account.id} v${characterVersion}: preserved fixed-age 72h analysis (${exact72Count} valid exact snapshots); legacy fallback skipped.`,
        );
        skipped += 1;
        continue;
      }

      const sourceCounts = cohort.posts.reduce(
        (counts, post) => {
          counts[post.source] += 1;
          return counts;
        },
        { snapshot: 0, fetched_at: 0 },
      );

      console.log(
        `[LegacyCohort] ${account.handle ?? account.id} v${characterVersion}: ${analysis.analyzedPosts} posts, approx ${cohort.measurementWindow}, age ${cohort.cohortAgeHours.min}-${cohort.cohortAgeHours.max}h, basis=${cohort.measurementBasis}, sources=${JSON.stringify(sourceCounts)}, median views=${analysis.accountMedianImpressions}, median engagement=${((analysis.accountMedianEngagementRate ?? 0) * 100).toFixed(2)}%.`,
      );
      updated += 1;
    } catch (error) {
      console.error(
        `[LegacyCohort] Failed for ${account.handle ?? account.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log(
    `[LegacyCohort] Updated ${updated} accounts; skipped ${skipped} for insufficient comparable observations.`,
  );
}

main().catch((error) => {
  console.error("[LegacyCohort] Fatal error:", error);
  process.exit(1);
});
