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
      ? options.proxyValue ?? 0
      : 0);

  const linkClicks = metrics.link_clicks ?? 0;

  // Weights for each metric
  const weights = {
    impressions: 5,
    likes: 2,
    reposts: 3,
    replies: 1,
    linkClicks: 2,
  };

  const score =
    impressions * weights.impressions +
    metrics.likes * weights.likes +
    metrics.reposts_or_rethreads * weights.reposts +
    metrics.replies * weights.replies +
    linkClicks * weights.linkClicks;

  return Number(score.toFixed(6));
}
