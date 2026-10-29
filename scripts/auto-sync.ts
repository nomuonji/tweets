import { syncPostsForAllAccounts } from "@/lib/services/sync-service";

async function main() {
  console.log("[Auto-Sync] Starting daily post synchronization for publishing accounts.");
  // Stopped accounts cannot gain new posts; syncing them only spends paid API
  // calls on the same history. Metrics on old posts can still be refreshed by
  // an explicit run with accountIds.
  const result = await syncPostsForAllAccounts({ onlyPublishing: true });
  console.log("[Auto-Sync] Synchronization finished.", result);
}

main().catch((error) => {
  console.error("[Auto-Sync] An error occurred during the sync process:", error);
  process.exit(1);
});
