import { ScoreOptions } from "./types";

type ScoreInput = {
  metrics: {
    impressions: number | null;
    likes: number;
    replies: number;
    reposts_or_rethreads: number;
    link_clicks?: number | null;
  };
};

export function calculateScore({ metrics }: ScoreInput, options: ScoreOptions) {
  const impressions =
    metrics.impressions ??
    (options.settings.use_impression_proxy
      ? options.proxyValue ?? 1
      : 1);

  const linkClicks = metrics.link_clicks ?? 0;

  const numerator =
    metrics.likes * 2 +
    metrics.reposts_or_rethreads * 3 +
    metrics.replies +
    linkClicks * 2;

  const effectiveImpressions = impressions > 0 ? impressions : 1;
  const engagementRate = numerator / effectiveImpressions;
  const reachFactor =
    impressions > 0 ? 1 + Math.log10(effectiveImpressions + 1) * 0.1 : 1;

  if (impressions <= 0) {
    return Number((numerator * reachFactor).toFixed(6));
  }

  return Number((engagementRate * reachFactor).toFixed(6));
}
