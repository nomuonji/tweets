import { syncPostsForAllAccounts } from "@/lib/services/sync-service";

async function main() {
  const results = await syncPostsForAllAccounts();
  console.log("Sync completed", JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error("Sync failed", error);
  process.exit(1);
});
