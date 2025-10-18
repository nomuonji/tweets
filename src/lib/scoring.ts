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

  if (impressions <= 0) {
    return numerator;
  }

  return Number((numerator / impressions).toFixed(6));
}
