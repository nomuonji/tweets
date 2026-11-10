import {
  getAccounts,
  getUsableDraftsByAccountId,
} from "@/lib/services/firestore.server";
import { generatePosts } from "@/lib/services/prompt-service";
import { getCharacterVersion } from "@/lib/character-version";
import { GenerationUnavailableError } from "@/lib/ai/generation-client";
import { isPublishingEnabled } from "@/lib/account-gates";

const DRAFT_THRESHOLD = 5;

async function main() {
  // Drafts are normally written by an external agent over MCP, which can plan a
  // batch (distinct 型, distinct openings) instead of one isolated post at a time.
  // This server-side path stays as a fallback and must be opted into explicitly.
  if (process.env.ALLOW_AUTO_GENERATION !== "true") {
    console.log(
      "[Auto-Generate] Disabled. Use get_generation_brief + create_drafts from an agent, or set ALLOW_AUTO_GENERATION=true.",
    );
    return;
  }
  console.log("[Auto-Generate] Starting periodic draft generation check.");
  const accounts = await getAccounts();
  const failedAccounts: string[] = [];
  let providerDegraded = false;

  for (const account of accounts) {
    if (providerDegraded) {
      console.warn(`[Auto-Generate] Text-generation providers are degraded; skipping remaining account ${account.id}.`);
      continue;
    }
    if (!isPublishingEnabled(account)) {
      console.log(`[Auto-Generate] Account ${account.handle}: auto-post is off; skipping.`);
      continue;
    }
    if (account.serverGenerationEnabled === false) {
      console.log(`[Auto-Generate] Account ${account.handle}: drafts come from an external agent only; skipping.`);
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

      const neededCount = DRAFT_THRESHOLD - usableDrafts.length;
      console.log(`[Auto-Generate] Account ${account.handle} has ${usableDrafts.length} usable drafts. Generating ${neededCount} in one batch request...`);
      const drafts = await generatePosts(account.id, account.platform, neededCount);
      if (drafts.length === 0) {
        console.log(`[Auto-Generate] No refill needed for ${account.handle}; inventory was updated by another path before save.`);
        continue;
      }
      const provider = drafts[0].generatedBy ?? "unknown";
      console.log(`[Auto-Generate] Saved ${drafts.length}/${neededCount} drafts via ${provider} for ${account.handle} in one generation request.`);
      if (drafts.length < neededCount) {
        console.warn(`[Auto-Generate] Batch returned ${drafts.length}/${neededCount}; the next fallback cycle can top up the remaining gap.`);
      }

    } catch (error) {
      console.error(`[Auto-Generate] Failed to process account ${account.handle}:`, error);
      const message = (error as Error).message ?? String(error);
      if (error instanceof GenerationUnavailableError || /\b(429|503)\b|api key|not configured/i.test(message)) {
        providerDegraded = true;
        console.warn("[Auto-Generate] Provider degradation detected; stopping further calls for this run.");
        continue;
      }
      failedAccounts.push(account.id);
    }
  }
  console.log("[Auto-Generate] Periodic draft generation check finished.");
  if (providerDegraded) {
    console.warn("::warning title=Draft generation degraded::Gemini and its OpenRouter fallback are unavailable.");
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
