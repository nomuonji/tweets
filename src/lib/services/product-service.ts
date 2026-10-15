import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { ProductDoc } from "@/lib/types";
import { DateTime } from "luxon";

function productCollection(accountId: string) {
  return adminDb.collection("accounts").doc(accountId).collection("products");
}

function catalogCollection() {
  return adminDb.collection("products");
}

async function hydrateProduct(accountId: string, doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<ProductDoc> {
  const data = doc.data() as Record<string, unknown>;
  const catalogId = String(data.catalog_id ?? data.asin ?? doc.id).toUpperCase();
  const catalog = await catalogCollection().doc(catalogId).get();
  if (!catalog.exists) return { id: doc.id, ...data } as ProductDoc;
  const catalogData = catalog.data() ?? {};
  return {
    id: doc.id, ...catalogData, ...data, catalog_id: catalogId,
    title: String(catalogData.title ?? data.title ?? ""),
    asin: String(catalogData.asin ?? data.asin ?? catalogId),
    url: String(catalogData.url ?? data.url ?? ""),
    price: String(catalogData.price ?? data.price ?? ""),
    category: String(catalogData.category ?? data.category ?? ""),
    description: String(catalogData.description ?? data.description ?? ""),
    promo_hook: String(data.promo_hook ?? catalogData.promo_hook ?? ""),
  } as ProductDoc;
}

export async function getProductsForAccount(accountId: string): Promise<ProductDoc[]> {
  const snapshot = await productCollection(accountId).orderBy("created_at", "desc").get();
  return Promise.all(snapshot.docs.map((doc) => hydrateProduct(accountId, doc)));
}

type TargetedProduct = ProductDoc & {
  status?: string;
  amazon_verified?: boolean;
  account_ids?: string[];
  reply_targets?: Record<string, string[]>;
};

function isApprovedForAccount(product: TargetedProduct, accountId: string): boolean {
  if (product.status !== "approved" || product.amazon_verified !== true) return false;
  if (!product.account_ids?.includes(accountId)) return false;
  if (!product.reply_targets?.[accountId]?.length) return false;
  try {
    const url = new URL(product.url ?? "");
    return url.protocol === "https:" &&
      url.hostname === "www.amazon.co.jp" &&
      url.pathname.split("/").filter(Boolean).slice(0, 2).join("/") === `dp/${product.asin}` &&
      Boolean(url.searchParams.get("tag"));
  } catch { return false; }
}

export async function getEligibleProducts(accountId: string): Promise<ProductDoc[]> {
  const snapshot = await catalogCollection().where("account_ids", "array-contains", accountId).get();
  return snapshot.docs.map((doc) => ({
    ...doc.data(), id: doc.id, enabled: true, times_used: Number(doc.data().times_used ?? 0),
  } as TargetedProduct)).filter((product) => isApprovedForAccount(product, accountId));
}

export async function getProduct(accountId: string, productId: string): Promise<ProductDoc | null> {
  const doc = await productCollection(accountId).doc(productId).get();
  if (!doc.exists) return null;
  return hydrateProduct(accountId, doc as FirebaseFirestore.QueryDocumentSnapshot);
}

/** Choose an approved product with an explicit account-specific topic match. */
export async function pickPromoProduct(accountId: string, postText: string): Promise<ProductDoc | null> {
  const products = (await getEligibleProducts(accountId)) as TargetedProduct[];
  const text = postText.normalize("NFKC").toLowerCase();
  const ranked = products.map((product) => {
    const hits = (product.reply_targets?.[accountId] ?? [])
      .map((term) => term.normalize("NFKC").toLowerCase().trim())
      .filter((term) => term.length >= 2 && text.includes(term));
    return { product, topicScore: hits.length ? Math.max(...hits.map((term) => term.length)) * 10 + hits.length : 0 };
  }).filter(({ topicScore }) => topicScore > 0);
  ranked.sort((a, b) => b.topicScore - a.topicScore ||
    (a.product.times_used ?? 0) - (b.product.times_used ?? 0));
  return ranked[0]?.product ?? null;
}

export async function markProductUsed(accountId: string, productId: string) {
  const ref = catalogCollection().doc(productId);
  const current = await ref.get();
  if (!current.exists || !isApprovedForAccount(current.data() as TargetedProduct, accountId)) {
    throw new Error("Product assignment changed before recording use");
  }
  await ref.update({
    times_used: FieldValue.increment(1), last_used_at: DateTime.utc().toISO(), updated_at: DateTime.utc().toISO(),
  });
}

export async function createProduct(accountId: string, data: Omit<ProductDoc, "id">): Promise<ProductDoc> {
  const asin = data.asin.trim().toUpperCase();
  const now = DateTime.utc().toISO();
  const catalogRef = catalogCollection().doc(asin);
  const existingCatalog = await catalogRef.get();
  const { enabled, times_used, last_used_at, promo_hook, ...catalogData } = data;
  delete (catalogData as Record<string, unknown>).catalog_id;
  await catalogRef.set({ ...catalogData, asin, created_at: existingCatalog.data()?.created_at ?? now, updated_at: now }, { merge: true });
  const ref = productCollection(accountId).doc(asin);
  await ref.set({
    catalog_id: asin, enabled: enabled ?? true, promo_hook: promo_hook ?? "", times_used: times_used ?? 0,
    ...(last_used_at ? { last_used_at } : {}), created_at: existingCatalog.data()?.created_at ?? now, updated_at: now,
  }, { merge: true });
  return (await getProduct(accountId, ref.id)) as ProductDoc;
}

export async function updateProduct(accountId: string, productId: string, data: Partial<Omit<ProductDoc, "id">>): Promise<ProductDoc | null> {
  const ref = productCollection(accountId).doc(productId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const current = doc.data() as Record<string, unknown>;
  const catalogId = String(current.catalog_id ?? current.asin ?? productId).toUpperCase();
  const catalog = await catalogCollection().doc(catalogId).get();
  const now = DateTime.utc().toISO();
  if (catalog.exists) {
    const assignmentKeys = new Set(["enabled", "promo_hook", "times_used", "last_used_at"]);
    const assignmentPatch: Record<string, unknown> = { updated_at: now, catalog_id: catalogId };
    const catalogPatch: Record<string, unknown> = { updated_at: now };
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || key === "catalog_id") continue;
      (assignmentKeys.has(key) ? assignmentPatch : catalogPatch)[key] = value;
    }
    await Promise.all([ref.update(assignmentPatch), catalog.ref.update(catalogPatch)]);
  } else {
    await ref.update({ ...data, updated_at: now });
  }
  return getProduct(accountId, productId);
}

export async function deleteProduct(accountId: string, productId: string): Promise<boolean> {
  const ref = productCollection(accountId).doc(productId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
}
