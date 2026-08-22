import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { ProductCatalogDoc, ProductPoolStatus } from "@/lib/types";

/** The canonical product catalog. Account subcollections contain assignments only. */
const collection = () => adminDb.collection("products");

export async function getProductPool(): Promise<ProductCatalogDoc[]> {
  try {
    const snapshot = await collection().orderBy("updated_at", "desc").get();
    return attachAccountIds(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ProductCatalogDoc));
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!message.includes("requires an index")) throw error;
    const snapshot = await collection().get();
    const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ProductCatalogDoc)
      .sort((a, b) => DateTime.fromISO(b.updated_at).toMillis() - DateTime.fromISO(a.updated_at).toMillis());
    return attachAccountIds(products);
  }
}

async function attachAccountIds(products: ProductCatalogDoc[]) {
  if (products.length === 0) return products;
  const accounts = await adminDb.collection("accounts").get();
  const accountIds = new Map<string, string[]>();
  await Promise.all(accounts.docs.map(async (account) => {
    const assignments = await account.ref.collection("products").get();
    assignments.docs.forEach((doc) => {
      const data = doc.data();
      const asin = String(data.catalog_id ?? data.asin ?? doc.id).toUpperCase();
      if (!products.some((product) => product.id.toUpperCase() === asin)) return;
      const current = accountIds.get(asin) ?? [];
      current.push(account.id);
      accountIds.set(asin, current);
    });
  }));
  return products.map((product) => ({ ...product, account_ids: accountIds.get(product.id.toUpperCase()) ?? [] }));
}

export async function createProductPoolItem(
  data: Omit<ProductCatalogDoc, "id" | "created_at" | "updated_at" | "account_ids">,
): Promise<ProductCatalogDoc> {
  const asin = data.asin.trim().toUpperCase();
  const ref = collection().doc(asin);
  if ((await ref.get()).exists) throw new Error("同じASINの商品がすでにカタログにあります。");
  const now = DateTime.utc().toISO();
  const product: ProductCatalogDoc = { id: asin, ...data, asin, created_at: now, updated_at: now };
  await ref.set(product);
  return product;
}

export async function updateProductPoolItem(
  id: string,
  data: Partial<Omit<ProductCatalogDoc, "id" | "created_at" | "updated_at" | "account_ids">>,
): Promise<ProductCatalogDoc | null> {
  const ref = collection().doc(id);
  const existing = await ref.get();
  if (!existing.exists) return null;
  await ref.update({ ...data, updated_at: DateTime.utc().toISO() });
  const updated = await ref.get();
  return { id: updated.id, ...updated.data() } as ProductCatalogDoc;
}

export async function deleteProductPoolItem(id: string): Promise<boolean> {
  const ref = collection().doc(id);
  const existing = await ref.get();
  if (!existing.exists) return false;
  await ref.delete();
  return true;
}

export const PRODUCT_POOL_STATUSES: ProductPoolStatus[] = [
  "candidate",
  "approved",
  "archived",
];

async function findAssignment(accountId: string, asin: string) {
  const snapshot = await adminDb.collection("accounts").doc(accountId).collection("products").get();
  return snapshot.docs.find((doc) => String(doc.data().catalog_id ?? doc.data().asin ?? doc.id).toUpperCase() === asin.toUpperCase()) ?? null;
}

export async function syncProductAssignments(asin: string, accountIds: string[]) {
  const normalizedAsin = asin.trim().toUpperCase();
  const accounts = await adminDb.collection("accounts").get();
  const selected = new Set(accountIds);
  await Promise.all(accounts.docs.map(async (account) => {
    const ref = account.ref.collection("products");
    const existing = await findAssignment(account.id, normalizedAsin);
    if (selected.has(account.id)) {
      const catalog = await collection().doc(normalizedAsin).get();
      if (!catalog.exists) return;
      const catalogData = catalog.data() ?? {};
      const assignmentRef = existing?.ref ?? ref.doc(normalizedAsin);
      const assignmentData = existing?.data() ?? {};
      await assignmentRef.set({
        catalog_id: normalizedAsin,
        enabled: assignmentData.enabled ?? true,
        promo_hook: assignmentData.promo_hook ?? catalogData.promo_hook ?? "",
        times_used: assignmentData.times_used ?? 0,
        ...(assignmentData.last_used_at ? { last_used_at: assignmentData.last_used_at } : {}),
        created_at: assignmentData.created_at ?? DateTime.utc().toISO(),
        updated_at: DateTime.utc().toISO(),
      }, { merge: true });
    } else if (existing?.data().catalog_id) {
      await existing.ref.delete();
    }
  }));
}
