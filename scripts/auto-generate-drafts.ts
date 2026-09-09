import {
  getAccounts,
  getUsableDraftsByAccountId,
} from "@/lib/services/firestore.server";
import { generatePost } from "@/lib/services/prompt-service";
import { getCharacterVersion } from "@/lib/character-version";

const DRAFT_THRESHOLD = 5;

async function main() {
  console.log("[Auto-Generate] Starting periodic draft generation check.");
  const accounts = await getAccounts();
  const failedAccounts: string[] = [];
  let providerDegraded = false;

  for (const account of accounts) {
    if (providerDegraded) {
      console.warn(`[Auto-Generate] Gemini is degraded; skipping remaining account ${account.id}.`);
      continue;
    }
    if (account.autoPostEnabled !== true) {
      console.log(`[Auto-Generate] Account ${account.handle}: auto-post is off; skipping.`);
      continue;
    }
    try {
      const characterVersion = getCharacterVersion(account);
      const usableDrafts = await getUsableDraftsByAccountId(
        account.id,
        characterVersion,
        DRAFT_THRESHOLD,
      );

      if (usableDrafts.length >= DRAFT_THRESHOLD) {
        console.log(`[Auto-Generate] Account ${account.handle} has enough drafts (${usableDrafts.length}). Skipping.`);
        continue;
      }

      console.log(`[Auto-Generate] Account ${account.handle} has ${usableDrafts.length} usable drafts. Generating a new one...`);
      await generatePost(account.id, account.platform);
      console.log(`[Auto-Generate] Successfully generated a new draft for ${account.handle}.`);

    } catch (error) {
      console.error(`[Auto-Generate] Failed to process account ${account.handle}:`, error);
      const message = (error as Error).message ?? String(error);
      if (/\b(429|503)\b|gemini.*(key|config|not configured)|api key/i.test(message)) {
        providerDegraded = true;
        console.warn("[Auto-Generate] Gemini provider degradation detected; stopping further calls for this run.");
        continue;
      }
      failedAccounts.push(account.id);
    }
  }
  console.log("[Auto-Generate] Periodic draft generation check finished.");
  if (providerDegraded) {
    console.warn("::warning title=Gemini draft generation degraded::Use the Tweets MCP/Codex replenishment task until Gemini recovers.");
  }
  if (failedAccounts.length > 0) {
    console.error(
      `::error title=Draft generation failed::${failedAccounts.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[Auto-Generate] An unexpected error occurred:", error);
  process.exit(1);
});
