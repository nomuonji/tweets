import assert from "node:assert/strict";
import type { PostDoc, PostMetrics } from "@/lib/types";
import { selectAgeMatchedCohort } from "@/lib/performance-cohorts";

function metrics(views: number): PostMetrics {
  return {
    impressions: views,
    likes: 2,
    replies: 1,
    reposts_or_rethreads: 0,
    quotes: 0,
    link_clicks: null,
  };
}

function legacyPost(
  id: string,
  version: number,
  ageHours: number,
  views: number,
): PostDoc {
  const created = Date.parse("2026-10-01T00:00:00.000Z");
  return {
    id,
    account_id: "threads_test",
    platform: "threads",
    platform_post_id: id,
    text: "A post with a simple observation.",
    created_at: new Date(created).toISOString(),
    fetched_at: new Date(created + ageHours * 3_600_000).toISOString(),
    media_type: "text",
    has_url: false,
    metrics: metrics(views),
    score: 1,
    character_version: version,
  };
}

function snapshotPost(id: string): PostDoc {
  const post = legacyPost(id, 3, 80, 10);
  post.performance_snapshots = {
    "72h": {
      captured_at: "2026-10-04T00:00:00.000Z",
      age_hours: 72,
      exposure_metric: "views",
      metrics: metrics(120),
    },
  };
  return post;
}

// Prefer the dominant age-matched cohort, excluding other character versions,
// invalid metrics, and posts whose fetch age is outside the supported bands.
const cohort48 = selectAgeMatchedCohort(
  [
    ...[40, 42, 44, 46, 50, 54].map((age, i) =>
      legacyPost(`48h-${i}`, 3, age, 100 + i),
    ),
    legacyPost("old-character", 2, 48, 999),
    legacyPost("outside-window", 3, 25, 999),
    { ...legacyPost("zero-views", 3, 48, 0) },
    legacyPost("minority-72h", 3, 72, 200),
  ],
  3,
);
assert.ok(cohort48);
assert.equal(cohort48.measurementWindow, "48h");
assert.deepEqual(cohort48.cohortAgeHours, { min: 36, max: 60 });
assert.equal(cohort48.posts.length, 6);
assert.equal(cohort48.measurementBasis, "fetched_at_age_matched");

const cohort72 = selectAgeMatchedCohort(
  [
    ...[64, 66, 68, 70, 72].map((age, i) =>
      legacyPost(`72h-${i}`, 3, age, 300 + i),
    ),
    snapshotPost("exact-snapshot"),
    ...[40, 42, 44, 46, 50].map((age, i) =>
      legacyPost(`48h-${i}`, 3, age, 100 + i),
    ),
  ],
  3,
);
assert.ok(cohort72);
assert.equal(cohort72.measurementWindow, "72h");
assert.equal(cohort72.posts.length, 6);
assert.equal(cohort72.measurementBasis, "mixed_exact_snapshot_and_fetched_at");
assert.equal(
  cohort72.posts.find((post) => post.source === "snapshot")?.metrics.impressions,
  120,
);

// Four observations remain descriptive only; the caller applies the 5-post
// production threshold and does not persist a low-sample analysis.
const cohort4 = selectAgeMatchedCohort(
  [40, 42, 44, 46].map((age, i) =>
    legacyPost(`few-${i}`, 3, age, 100 + i),
  ),
  3,
);
assert.equal(cohort4?.posts.length, 4);

console.log("Legacy performance cohort tests passed.");
