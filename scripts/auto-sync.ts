import { syncPostsForAllAccounts } from "@/lib/services/sync-service";

async function main() {
  console.log("[Auto-Sync] Starting daily post synchronization for all accounts.");
  const result = await syncPostsForAllAccounts({});
  console.log("[Auto-Sync] Synchronization finished.", result);
}

main().catch((error) => {
  console.error("[Auto-Sync] An error occurred during the sync process:", error);
  process.exit(1);
});
