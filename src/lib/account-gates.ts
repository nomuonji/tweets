import type { AccountDoc } from "@/lib/types";

type GateShape = Pick<AccountDoc, "discoveryEnabled" | "performanceLearningEnabled" | "autoPostEnabled">;

/**
 * External inspiration pipeline only. This flag must not disable learning
 * from the account's own published posts.
 */
export function isDiscoveryEnabled(account: GateShape): boolean {
  return account.discoveryEnabled ?? (account.autoPostEnabled === true);
}

/**
 * Self-performance learning is independent from external discovery.
 * Unset preserves legacy behavior for existing auto-posting accounts.
 */
export function isPerformanceLearningEnabled(account: GateShape): boolean {
  return account.performanceLearningEnabled ?? (account.autoPostEnabled === true);
}

/** Output pipeline: draft generation and scheduled publishing. */
export function isPublishingEnabled(account: GateShape): boolean {
  return account.autoPostEnabled === true;
}
