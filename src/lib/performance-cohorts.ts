import { belongsToCharacterVersion } from "@/lib/character-version";
import type { PostDoc, PostMetrics } from "@/lib/types";

export type AgeMatchedMeasurementWindow = "48h" | "72h";
export type MeasurementBasis =
  | "fixed_age_snapshot"
  | "fetched_at_age_matched"
  | "mixed_exact_snapshot_and_fetched_at";

export interface AgeMatchedPost {
  text: string;
  metrics: PostMetrics;
  ageHours: number;
  source: "snapshot" | "fetched_at";
}

export interface AgeMatchedCohort {
  measurementWindow: AgeMatchedMeasurementWindow;
  cohortAgeHours: { min: number; max: number };
  measurementBasis: MeasurementBasis;
  counts: { "48h": number; "72h": number };
  posts: AgeMatchedPost[];
}

const COHORTS = {
  "48h": { min: 36, max: 60 },
  "72h": { min: 60, max: 84 },
} as const;

function validExposure(metrics: PostMetrics | undefined): metrics is PostMetrics {
  return (
    typeof metrics?.impressions === "number" &&
    Number.isFinite(metrics.impressions) &&
    metrics.impressions > 0
  );
}

/**
 * Uses previously synchronized lifetime metrics only when fetched_at proves
 * they were observed inside a narrow, comparable post-age cohort.
 * Exact 72h snapshots take precedence for the same post.
 */
export function selectAgeMatchedCohort(
  posts: PostDoc[],
  currentCharacterVersion: number,
): AgeMatchedCohort | null {
  const candidates: Record<AgeMatchedMeasurementWindow, AgeMatchedPost[]> = {
    "48h": [],
    "72h": [],
  };

  for (const post of posts) {
    if (!belongsToCharacterVersion(post, currentCharacterVersion)) continue;

    const exact72 = post.performance_snapshots?.["72h"];
    if (
      exact72 &&
      exact72.age_hours >= COHORTS["72h"].min &&
      exact72.age_hours <= COHORTS["72h"].max &&
      validExposure(exact72.metrics)
    ) {
      candidates["72h"].push({
        text: post.text,
        metrics: exact72.metrics,
        ageHours: exact72.age_hours,
        source: "snapshot",
      });
      continue;
    }

    if (!validExposure(post.metrics) || !post.created_at || !post.fetched_at) continue;
    const createdAt = Date.parse(post.created_at);
    const fetchedAt = Date.parse(post.fetched_at);
    if (!Number.isFinite(createdAt) || !Number.isFinite(fetchedAt)) continue;

    const ageHours = (fetchedAt - createdAt) / 3_600_000;
    const window: AgeMatchedMeasurementWindow | null =
      ageHours >= COHORTS["48h"].min && ageHours <= COHORTS["48h"].max
        ? "48h"
        : ageHours >= COHORTS["72h"].min && ageHours <= COHORTS["72h"].max
          ? "72h"
          : null;
    if (!window) continue;

    candidates[window].push({
      text: post.text,
      metrics: post.metrics,
      ageHours,
      source: "fetched_at",
    });
  }

  const counts = {
    "48h": candidates["48h"].length,
    "72h": candidates["72h"].length,
  };
  const measurementWindow: AgeMatchedMeasurementWindow =
    counts["72h"] >= counts["48h"] ? "72h" : "48h";
  const selected = candidates[measurementWindow];
  if (selected.length === 0) return null;

  const hasSnapshot = selected.some((post) => post.source === "snapshot");
  const hasFetchedAt = selected.some((post) => post.source === "fetched_at");
  const measurementBasis: MeasurementBasis =
    hasSnapshot && hasFetchedAt
      ? "mixed_exact_snapshot_and_fetched_at"
      : hasSnapshot
        ? "fixed_age_snapshot"
        : "fetched_at_age_matched";

  return {
    measurementWindow,
    cohortAgeHours: COHORTS[measurementWindow],
    measurementBasis,
    counts,
    posts: selected,
  };
}
