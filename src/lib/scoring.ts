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
  const impressions = metrics.impressions ?? 0;
  const likes = metrics.likes ?? 0;
  const reposts = metrics.reposts_or_rethreads ?? 0;
  const replies = metrics.replies ?? 0;
  const clicks = metrics.link_clicks ?? 0;

  const score =
    impressions * 0.1 +
    likes * 40 +
    reposts * 80 +
    replies * 70 +
    clicks * 60;

  return score;
}
