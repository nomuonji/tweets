import type { PostMetrics, PostPerformanceSnapshot } from "@/lib/types";

export type PerformanceWindow = "24h" | "72h";
export type PerformanceSnapshotUpdate = Partial<
  Record<PerformanceWindow, PostPerformanceSnapshot>
>;

/**
 * The scheduled sync runs every six hours. Capture one observation in the
 * first sync window after each target age, rather than comparing lifetime
 * totals from posts with different amounts of exposure time.
 *
 * A missed window is intentionally left missing; we do not backfill a later
 * cumulative value and mislabel it as a 24h/72h observation.
 */
const WINDOWS: Record<PerformanceWindow, { start: number; end: number }> = {
  "24h": { start: 24, end: 30 },
  "72h": { start: 72, end: 78 },
};

export function buildPerformanceSnapshotUpdate(
  createdAt: string,
  metrics: PostMetrics,
  exposureMetric: "views" | "impressions",
  now: Date = new Date(),
): PerformanceSnapshotUpdate {
  const createdAtMs = Date.parse(createdAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return {};

  const ageHours = (nowMs - createdAtMs) / (60 * 60 * 1000);
  if (ageHours < 0) return {};

  const update: PerformanceSnapshotUpdate = {};
  for (const [window, bounds] of Object.entries(WINDOWS) as Array<
    [PerformanceWindow, { start: number; end: number }]
  >) {
    if (ageHours < bounds.start || ageHours >= bounds.end) continue;
    update[window] = {
      captured_at: now.toISOString(),
      age_hours: Number(ageHours.toFixed(2)),
      exposure_metric: exposureMetric,
      metrics: {
        impressions: metrics.impressions ?? null,
        likes: metrics.likes ?? 0,
        replies: metrics.replies ?? 0,
        reposts_or_rethreads: metrics.reposts_or_rethreads ?? 0,
        quotes: metrics.quotes ?? 0,
        link_clicks: metrics.link_clicks ?? null,
      },
    };
  }
  return update;
}
