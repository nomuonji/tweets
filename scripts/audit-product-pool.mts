import "dotenv/config";
import { adminDb } from "@/lib/firebase/admin";

async function main() {
  const snapshot = await adminDb.collection("products").get();
  const docs = snapshot.docs.map((doc) => doc.data());
  const invalid = docs.filter((x) =>
    !/^[A-Z0-9]{10}$/.test(String(x.asin ?? "")) ||
    !String(x.url ?? "").includes("tag=tweets-sns-22") ||
    !x.theme || !x.role || typeof x.score !== "number"
  );
  const accounts = await adminDb.collection("accounts").get();
  let assignedCatalogItems = 0;
  for (const account of accounts.docs) {
    const assignments = await account.ref.collection("products").get();
    assignedCatalogItems += assignments.docs.filter((doc) => {
      const data = doc.data();
      const asin = String(data.catalog_id ?? data.asin ?? doc.id).toUpperCase();
      return snapshot.docs.some((candidate) => candidate.id === asin);
    }).length;
  }
  const status = docs.reduce<Record<string, number>>((result, item) => {
    const key = String(item.status ?? "unknown");
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  const scores = docs.map((item) => Number(item.score ?? 0));
  console.log(JSON.stringify({
    catalogCount: snapshot.size,
    invalid: invalid.length,
    missingAffiliateTag: docs.filter((x) => !String(x.url ?? "").includes("tag=tweets-sns-22")).length,
    accountCount: accounts.size,
    assignedCatalogItems,
    status,
    scoreMin: Math.min(...scores),
    scoreMax: Math.max(...scores),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
