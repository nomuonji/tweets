import { getAccounts } from "@/lib/services/firestore.server";
import { syncExternalDiscovery } from "@/lib/services/external-discovery-service";
import { isDiscoveryEnabled } from "@/lib/account-gates";

async function main() {
  const accounts = await getAccounts();
  for (const account of accounts) {
    if (!isDiscoveryEnabled(account)) {
      continue;
    }
    if (
      (account.discoveryKeywords?.length ?? 0) === 0 &&
      (account.referenceAccountIds?.length ?? 0) === 0
    ) {
      continue;
    }
    try {
      const result = await syncExternalDiscovery(account);
      const detail = result.synced.join(", ") || "cache is fresh";
      const budgetNote = result.stoppedByBudget
        ? ` (stopped by budget: ${result.budget.count}/${result.budget.budget ?? "-"})`
        : "";
      console.log(`[External Sync] ${account.handle}: ${detail}${budgetNote}`);
      if (result.stoppedByBudget) break;
    } catch (error) {
      console.error(`[External Sync] Failed for ${account.handle}:`, error);
    }
  }
}

main().catch((error) => {
  console.error("[External Sync] Unexpected failure:", error);
  process.exit(1);
});
