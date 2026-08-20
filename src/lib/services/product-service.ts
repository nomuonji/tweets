import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { ProductDoc } from "@/lib/types";
import { DateTime } from "luxon";

function productCollection(accountId: string) {
  return adminDb.collection("accounts").doc(accountId).collection("products");
}

export async function getProductsForAccount(
  accountId: string,
): Promise<ProductDoc[]> {
  const snapshot = await productCollection(accountId)
    .orderBy("created_at", "desc")
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ProductDoc);
}

export async function getEligibleProducts(
  accountId: string,
): Promise<ProductDoc[]> {
  try {
    const snapshot = await productCollection(accountId)
      .where("enabled", "==", true)
      .orderBy("created_at", "desc")
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ProductDoc);
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!message.includes("requires an index")) throw error;
    const snapshot = await productCollection(accountId).get();
    const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ProductDoc);
    return products
      .filter((product) => product.enabled === true)
      .sort(
        (a, b) =>
          DateTime.fromISO(b.created_at).toMillis() -
          DateTime.fromISO(a.created_at).toMillis(),
      );
  }
}

export async function getProduct(
  accountId: string,
  productId: string,
): Promise<ProductDoc | null> {
  const doc = await productCollection(accountId).doc(productId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as ProductDoc;
}

/**
 * Pick a product to promote for the given account.
 * Rotation: least-used enabled products are preferred, with a small random
 * element so the same product does not get promoted every time.
 */
export async function pickPromoProduct(
  accountId: string,
): Promise<ProductDoc | null> {
  const products = await getEligibleProducts(accountId);
  if (products.length === 0) return null;

  const sorted = [...products].sort((a, b) => {
    if (a.times_used !== b.times_used) return a.times_used - b.times_used;
    const aLast = a.last_used_at ? DateTime.fromISO(a.last_used_at).toMillis() : 0;
    const bLast = b.last_used_at ? DateTime.fromISO(b.last_used_at).toMillis() : 0;
    return aLast - bLast;
  });

  // Pick from the least-used pool (top half, at least 1, at most 5).
  const poolSize = Math.min(5, Math.max(1, Math.ceil(sorted.length / 2)));
  const pool = sorted.slice(0, poolSize);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Record that a product was used so rotation can move on to others. */
export async function markProductUsed(accountId: string, productId: string) {
  const doc = productCollection(accountId).doc(productId);
  await doc.update({
    times_used: FieldValue.increment(1),
    last_used_at: DateTime.utc().toISO(),
    updated_at: DateTime.utc().toISO(),
  });
}

export async function createProduct(
  accountId: string,
  data: Omit<ProductDoc, "id">,
): Promise<ProductDoc> {
  const ref = productCollection(accountId).doc();
  const product: ProductDoc = { id: ref.id, ...data };
  await ref.set(product);
  return product;
}

export async function updateProduct(
  accountId: string,
  productId: string,
  data: Partial<Omit<ProductDoc, "id">>,
): Promise<ProductDoc | null> {
  const ref = productCollection(accountId).doc(productId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  await ref.update({ ...data, updated_at: DateTime.utc().toISO() });
  const updated = await ref.get();
  return { id: updated.id, ...updated.data() } as ProductDoc;
}

export async function deleteProduct(
  accountId: string,
  productId: string,
): Promise<boolean> {
  const doc = productCollection(accountId).doc(productId);
  const snapshot = await doc.get();
  if (!snapshot.exists) return false;
  await doc.delete();
  return true;
}