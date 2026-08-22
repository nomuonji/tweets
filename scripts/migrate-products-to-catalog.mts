import "dotenv/config";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";

const apply = process.argv.includes("--apply");

async function main() {
  const accounts = await adminDb.collection("accounts").get();
  let scanned = 0;
  let linked = 0;
  let createdCatalog = 0;

  for (const account of accounts.docs) {
    const assignments = await account.ref.collection("products").get();
    for (const assignment of assignments.docs) {
      scanned += 1;
      const data = assignment.data();
      const asin = String(data.catalog_id ?? data.asin ?? "").trim().toUpperCase();
      if (!asin || data.catalog_id) continue;

      const catalogRef = adminDb.collection("products").doc(asin);
      const catalog = await catalogRef.get();
      const now = DateTime.utc().toISO();
      if (!catalog.exists) {
        createdCatalog += 1;
        if (apply) {
          await catalogRef.set({
            asin,
            title: data.title ?? "",
            url: data.url ?? "",
            price: data.price ?? "",
            image_url: data.image_url ?? "",
            category: data.category ?? "",
            description: data.description ?? "",
            promo_hook: data.promo_hook ?? "",
            status: "candidate",
            created_at: data.created_at ?? now,
            updated_at: now,
          }, { merge: true });
        }
      }

      linked += 1;
      if (apply) {
        await assignment.ref.set({ catalog_id: asin, updated_at: now }, { merge: true });
      }
    }
  }

  console.log(JSON.stringify({ apply, scanned, linked, createdCatalog }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
