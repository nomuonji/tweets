import { appendFileSync } from "node:fs";
import { syncPostsForAllAccounts } from "@/lib/services/sync-service";

async function main() {
  const results = await syncPostsForAllAccounts();
  console.log("Sync completed", JSON.stringify(results, null, 2));

  const accountFailures = results.filter((result) => Boolean(result.error));
  const promoFailures = results.filter((result) => (result.promoFailures ?? 0) > 0);
  const syncedAccounts = results.filter((result) => !result.error).length;
  const promoPosted = results.reduce(
    (total, result) => total + (result.promoReplies ?? 0),
    0,
  );

  for (const result of accountFailures) {
    const message = `${result.accountId}: ${result.error}`.replace(/[\r\n]+/g, " ");
    console.warn(`::warning title=Account sync failed::${message}`);
  }
  for (const result of promoFailures) {
    const message = `${result.accountId}: ${result.promoFailures} promo attempt(s) failed${
      result.promoHaltedReason ? ` (${result.promoHaltedReason})` : ""
    }`;
    console.error(`::error title=Promo reply failed::${message}`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [
      "## Sync result",
      "",
      `- Accounts synced: ${syncedAccounts}/${results.length}`,
      `- Account sync failures: ${accountFailures.length}`,
      `- Promo replies posted: ${promoPosted}`,
      `- Accounts with promo failures: ${promoFailures.length}`,
      "",
      "| Account | Stored | Promo attempts | Promo posted | Promo failures | Result |",
      "|---|---:|---:|---:|---:|---|",
      ...results.map((result) =>
        `| ${result.accountId} | ${result.stored} | ${result.promoAttempts ?? 0} | ${result.promoReplies ?? 0} | ${result.promoFailures ?? 0} | ${result.error ? "sync failed" : result.promoHaltedReason ?? "ok"} |`,
      ),
      "",
    ];
    appendFileSync(summaryPath, lines.join("\n"), "utf8");
  }

  // A provider failure in the monetization path must not look green. Account
  // fetch failures remain warnings unless no account could be synced at all.
  if (promoFailures.length > 0 || (results.length > 0 && syncedAccounts === 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Sync failed", error);
  process.exit(1);
});
