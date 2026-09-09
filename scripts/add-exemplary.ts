/**
 * Verbatim-style exemplary post registration.
 *
 * Takes the reference post text as-is (line breaks, dialect, endings kept).
 * Only the other account's funnel lines (e.g. their free-consultation CTA)
 * must be removed before registering — never send traffic to the source.
 *
 * Exemplary posts are NOT length-checked against min/maxPostLength:
 * those constrain generated output only. Length is printed for reference.
 *
 * Usage (use \\n for line breaks):
 *   npx tsx -r dotenv/config scripts/add-exemplary.ts \
 *     --account threads_date_blueprints \
 *     --text "1行目\n\n2行目" \
 *     --explanation "REN骨格写し：問い→日常→引用→判定問い。元：183いいね139返信" \
 *     --source-url "https://www.threads.com/@ren_0411_oo"
 *
 *   Add --dry-run to validate without writing.
 */
import { adminDb } from "@/lib/firebase/admin";
import "dotenv/config";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const accountId = requireArg("account");
  const rawText = requireArg("text");
  const explanation = requireArg("explanation");
  const sourceUrl = arg("source-url") ?? "";
  const text = rawText.replace(/\\n/g, "\n");

  const accountDoc = await adminDb.collection("accounts").doc(accountId).get();
  if (!accountDoc.exists) {
    console.error(`account not found: ${accountId}`);
    process.exit(1);
  }
  if (explanation.length > 120) {
    console.error(`explanation ${explanation.length}字 > 120（プロンプトで切られる上限）`);
    process.exit(1);
  }

  console.log(`text (${text.length}字):\n${text}`);
  console.log(`explanation (${explanation.length}): ${explanation}`);
  if (sourceUrl) console.log(`source: ${sourceUrl}`);
  if (dryRun) {
    console.log("dry-run: not saved");
    return;
  }

  const now = new Date().toISOString();
  const ref = adminDb
    .collection("accounts")
    .doc(accountId)
    .collection("exemplary_posts")
    .doc();
  await ref.set({ text, explanation, created_at: now, updated_at: now });
  console.log(`saved ${accountId}/${ref.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
