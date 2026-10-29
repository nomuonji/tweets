import type { AccountDoc } from "@/lib/types";

type GateShape = Pick<AccountDoc, "discoveryEnabled" | "autoPostEnabled">;

/**
 * Learning pipeline: external-post collection and pattern analysis.
 *
 * Reading other accounts' winning structure has no output side effect, so it
 * must be switchable without starting the posting machine. Unset falls back to
 * `autoPostEnabled`, which keeps every existing account behaving as before.
 */
export function isDiscoveryEnabled(account: GateShape): boolean {
  return account.discoveryEnabled ?? (account.autoPostEnabled === true);
}

/** Output pipeline: draft generation and scheduled publishing. */
export function isPublishingEnabled(account: GateShape): boolean {
  return account.autoPostEnabled === true;
}
