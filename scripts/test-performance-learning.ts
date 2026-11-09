import assert from "node:assert/strict";
import { isDiscoveryEnabled, isPerformanceLearningEnabled } from "@/lib/account-gates";
import { engagementRate, computePatternAnalysis } from "@/lib/pattern";
import { buildPerformanceSnapshotUpdate } from "@/lib/performance-snapshots";
import type { PostMetrics } from "@/lib/types";

const activeWithDiscoveryOff = {
  autoPostEnabled: true,
  discoveryEnabled: false,
};
assert.equal(isDiscoveryEnabled(activeWithDiscoveryOff), false);
assert.equal(isPerformanceLearningEnabled(activeWithDiscoveryOff), true);

assert.equal(
  isPerformanceLearningEnabled({
    autoPostEnabled: true,
    discoveryEnabled: false,
    performanceLearningEnabled: false,
  }),
  false,
);
assert.equal(
  isPerformanceLearningEnabled({
    autoPostEnabled: false,
    discoveryEnabled: true,
  }),
  false,
);
assert.equal(
  isPerformanceLearningEnabled({ autoPostEnabled: true }),
  true,
);

const metrics: PostMetrics = {
  impressions: 120,
  likes: 8,
  replies: 2,
  reposts_or_rethreads: 1,
  quotes: 0,
  link_clicks: null,
};
assert.equal(engagementRate(metrics), 0.125);
assert.equal(
  engagementRate({
    impressions: null,
    likes: 8,
    replies: 2,
    reposts_or_rethreads: 1,
  }),
  null,
);
assert.equal(
  engagementRate({
    impressions: 0,
    likes: 8,
    replies: 2,
    reposts_or_rethreads: 1,
  }),
  null,
);

const now = new Date("2026-11-09T12:00:00.000Z");
const createdAtForAge = (ageHours: number) =>
  new Date(now.getTime() - ageHours * 60 * 60 * 1000).toISOString();

const at24 = buildPerformanceSnapshotUpdate(
  createdAtForAge(24),
  metrics,
  "views",
  now,
);
assert.equal(at24["24h"]?.age_hours, 24);
assert.equal(at24["24h"]?.exposure_metric, "views");
assert.equal(at24["24h"]?.metrics.impressions, 120);
assert.equal(at24["72h"], undefined);

assert.ok(buildPerformanceSnapshotUpdate(createdAtForAge(29.99), metrics, "views", now)["24h"]);
assert.equal(
  buildPerformanceSnapshotUpdate(createdAtForAge(30), metrics, "views", now)["24h"],
  undefined,
);
assert.ok(buildPerformanceSnapshotUpdate(createdAtForAge(72), metrics, "views", now)["72h"]);
assert.ok(buildPerformanceSnapshotUpdate(createdAtForAge(77.99), metrics, "views", now)["72h"]);
assert.equal(
  buildPerformanceSnapshotUpdate(createdAtForAge(78), metrics, "views", now)["72h"],
  undefined,
);
assert.deepEqual(
  buildPerformanceSnapshotUpdate("not-a-date", metrics, "views", now),
  {},
);

const makePost = (
  text: string,
  impressions: number,
  likes: number,
) => ({
  text,
  metrics: {
    impressions,
    likes,
    replies: 0,
    reposts_or_rethreads: 0,
  },
});
const reachFirstAnalysis = computePatternAnalysis(
  [
    makePost("春の朝は静かだ。", 100, 1),
    makePost("夕方の空気が好きだ。", 110, 1),
    makePost("雨の日は本を読みたくなる。", 90, 1),
    makePost("これってどう思う？", 10, 5),
    makePost("みんなはどうしてる？", 20, 5),
    makePost("これは普通なのかな？", 30, 5),
    makePost("表示数がない投稿", null as unknown as number, 100),
  ],
  "test-account",
  "72h",
  "views",
);
assert.equal(reachFirstAnalysis.analyzedPosts, 6);
assert.equal(reachFirstAnalysis.measurementWindow, "72h");
assert.equal(reachFirstAnalysis.exposureMetric, "views");
assert.equal(reachFirstAnalysis.patterns[0].structure, "一つの観察を短く言い切る");
assert.equal(reachFirstAnalysis.patterns[0].medianImpressions, 100);
assert.equal(reachFirstAnalysis.patterns[1].structure, "問いかけで始める");
assert.equal(reachFirstAnalysis.patterns[1].medianImpressions, 20);

console.log("Performance-learning tests passed.");
