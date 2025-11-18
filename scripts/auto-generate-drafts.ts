import { getAccounts, getDraftsByAccountId } from "@/lib/services/firestore.server";
import { generatePost } from "@/lib/services/prompt-service";

const DRAFT_THRESHOLD = 5;

async function main() {
  console.log("[Auto-Generate] Starting periodic draft generation check.");
  const accounts = await getAccounts();

  for (const account of accounts) {
    try {
      const existingDrafts = await getDraftsByAccountId(account.id);
      if (existingDrafts.length >= DRAFT_THRESHOLD) {
        console.log(`[Auto-Generate] Account ${account.handle} has enough drafts (${existingDrafts.length}). Skipping.`);
        continue;
      }

      console.log(`[Auto-Generate] Account ${account.handle} has ${existingDrafts.length} drafts. Generating a new one...`);
      await generatePost(account.id, account.platform);
      console.log(`[Auto-Generate] Successfully generated a new draft for ${account.handle}.`);

    } catch (error) {
      console.error(`[Auto-Generate] Failed to process account ${account.handle}:`, error);
    }
  }
  console.log("[Auto-Generate] Periodic draft generation check finished.");
}

main().catch((error) => {
  console.error("[Auto-Generate] An unexpected error occurred:", error);
  process.exit(1);
});
