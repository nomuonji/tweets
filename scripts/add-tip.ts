/**
 * Structured tip registration.
 *
 * Enforces the format decided 2026-09-05 so every tip survives the prompt
 * compaction (title <= 80, text <= 160) and carries the same fields:
 *   狙い / 型 / 例 / NG / 実績
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/add-tip.ts \
 *     --account threads_date_blueprints \
 *     --author ren_0411_oo \
 *     --url "https://www.threads.com/@ren_0411_oo" \
 *     --title "弱さ開示＋判定問いのリプ稼ぎ型" \
 *     --goal "リプを稼ぐ" \
 *     --pattern "LINE具体1場面＋弱さ開示＋判定問い・60〜100字" \
 *     --example "ご飯帰りLINE脈あり判定していい？" \
 *     --ng "採点・解説締め" \
 *     --record "@ren_0411_oo 183いいね139返信"
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
  const title = requireArg("title");
  const goal = requireArg("goal");
  const pattern = requireArg("pattern");
  const example = arg("example");
  const ng = arg("ng");
  const record = arg("record");
  const author = arg("author") ?? "";
  const url = arg("url") ?? "";

  const parts = [`狙い：${goal}`, `型：${pattern}`];
  if (example) parts.push(`例：${example}`);
  if (ng) parts.push(`NG：${ng}`);
  if (record) parts.push(`実績：${record}`);
  const text = parts.join("／");

  const errors: string[] = [];
  if (title.length > 80) errors.push(`title ${title.length}字 > 80`);
  if (text.length > 160) errors.push(`text ${text.length}字 > 160`);
  const accountDoc = await adminDb.collection("accounts").doc(accountId).get();
  if (!accountDoc.exists) errors.push(`account not found: ${accountId}`);
  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }

  console.log(`title (${title.length}): ${title}`);
  console.log(`text (${text.length}): ${text}`);
  if (dryRun) {
    console.log("dry-run: not saved");
    return;
  }

  const now = new Date().toISOString();
  const ref = adminDb.collection("tips").doc();
  await ref.set({
    title,
    text,
    platform: "threads",
    url,
    author_handle: author,
    account_ids: [accountId],
    created_at: now,
    updated_at: now,
  });
  console.log(`saved ${ref.id} -> ${accountId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
