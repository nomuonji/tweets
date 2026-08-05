import { getAccounts, getDraftsByAccountId } from "@/lib/services/firestore.server";
import { generatePost } from "@/lib/services/prompt-service";

const DRAFT_THRESHOLD = 5;

async function main() {
  console.log("[Auto-Generate] Starting periodic draft generation check.");
  const accounts = await getAccounts();

  for (const account of accounts) {
    try {
      const allDrafts = await getDraftsByAccountId(account.id);
      // Only drafts the scheduler can actually publish count toward the quota.
      // Counting `failed` ones too caused a deadlock: once 5 publishes failed,
      // generation stopped forever and the scheduler had nothing to post.
      const usableDrafts = allDrafts.filter(
        (draft) => draft.status === "draft" || draft.status === "scheduled",
      );
      const blocked = allDrafts.length - usableDrafts.length;

      if (usableDrafts.length >= DRAFT_THRESHOLD) {
        console.log(`[Auto-Generate] Account ${account.handle} has enough drafts (${usableDrafts.length}). Skipping.`);
        continue;
      }

      if (blocked > 0) {
        console.warn(`[Auto-Generate] Account ${account.handle} has ${blocked} draft(s) in a non-publishable state (failed/publishing).`);
      }

      console.log(`[Auto-Generate] Account ${account.handle} has ${usableDrafts.length} usable drafts. Generating a new one...`);
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
