import { getAccounts } from "@/lib/services/firestore.server";
import { syncExternalDiscovery } from "@/lib/services/external-discovery-service";

async function main() {
  const accounts = await getAccounts();
  for (const account of accounts) {
    if (
      (account.discoveryKeywords?.length ?? 0) === 0 &&
      (account.referenceAccountIds?.length ?? 0) === 0
    ) {
      continue;
    }
    try {
      const result = await syncExternalDiscovery(account);
      console.log(`[External Sync] ${account.handle}: ${result.synced.join(", ") || "cache is fresh"}`);
    } catch (error) {
      console.error(`[External Sync] Failed for ${account.handle}:`, error);
    }
  }
}

main().catch((error) => {
  console.error("[External Sync] Unexpected failure:", error);
  process.exit(1);
});
