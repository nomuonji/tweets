import { DateTime } from "luxon";
import type { PromoReplyDoc } from "@/lib/types";

export type PostAttemptState = {
  alreadyPosted: boolean;
  failureCount: number;
  retryAfter: DateTime | null;
};

export function isSuccessfulReply(reply: PromoReplyDoc): boolean {
  return reply.status === "posted" ||
    (!reply.error && Boolean(reply.platform_post_id));
}

/** Provider outages are run-level events, not failures of the original post. */
export function isProviderUnavailableFailure(reply: PromoReplyDoc): boolean {
  if (reply.failure_kind === "provider_unavailable") return true;
  if (reply.failure_kind) return false;
  const message = reply.error?.toLowerCase() ?? "";
  return message.includes("provider unavailable") ||
    message.includes("all gemini api keys") ||
    message.includes("gemini remained unavailable") ||
    message.includes("high demand") ||
    message.includes("quota exceeded");
}

export function summarizePostAttemptHistory(
  replies: PromoReplyDoc[],
): PostAttemptState {
  const failures = replies.filter((reply) =>
    !isSuccessfulReply(reply) && !isProviderUnavailableFailure(reply),
  );
  const retryAfter = failures
    .map((reply) => reply.retry_after_at ? DateTime.fromISO(reply.retry_after_at) : null)
    .filter((date): date is DateTime => Boolean(date?.isValid))
    .sort((a, b) => b.toMillis() - a.toMillis())[0] ?? null;

  return {
    alreadyPosted: replies.some(isSuccessfulReply),
    failureCount: failures.length,
    retryAfter,
  };
}
