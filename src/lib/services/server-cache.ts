import { cache } from "react";
import { getAccounts } from "./firestore.server";

/** Deduplicates account reads shared by a page and its root layout. */
export const getAccountsForRequest = cache(async () => {
  // `next build` evaluates page trees while collecting route data. Production
  // account data is runtime-only, so spending Firestore quota during a build
  // has no user-visible benefit.
  if (process.env.NEXT_PHASE === "phase-production-build") return [];
  return getAccounts();
});
