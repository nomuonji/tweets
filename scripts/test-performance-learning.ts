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
  impressions: number | null,
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
    makePost("表示数がない投稿", null, 100),
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
// Compare only within the same account and fixed-age exposure cohort:
// [10, 20, 30, 90, 100, 110] => account median 60.
assert.equal(reachFirstAnalysis.accountMedianImpressions, 60);
assert.ok(Math.abs((reachFirstAnalysis.patterns[0].medianExposureLift ?? 0) - 100 / 60) < 1e-10);
assert.ok(Math.abs((reachFirstAnalysis.patterns[1].medianExposureLift ?? 0) - 20 / 60) < 1e-10);
assert.equal(reachFirstAnalysis.patterns[0].outliersAtLeast3x, 0);

// A one-off 12x breakout is a candidate to inspect, NOT proof that its
// text structure caused the breakout. Zero/missing exposures cannot distort the baseline.
const withBreakout = computePatternAnalysis(
  [
    makePost("晴れた朝に出かけた。", 10, 1),
    makePost("昨日の風は冷たかった。", 20, 1),
    makePost("窓の外を見ていた。", 30, 1),
    makePost("猫が隣に座った。", 300, 4),
    makePost("測れていない投稿", 0, 10),
    makePost("指標が欠落した投稿", null, 10),
  ],
  "another-account",
  "24h",
  "impressions",
);
assert.equal(withBreakout.analyzedPosts, 4);
assert.equal(withBreakout.accountMedianImpressions, 25);
assert.equal(withBreakout.patterns[0].maxExposureLift, 12);
assert.equal(withBreakout.patterns[0].medianExposureLift, 1);
assert.equal(withBreakout.patterns[0].outliersAtLeast3x, 1);

console.log("Performance-learning tests passed.");
