import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getCharacterVersion } from "@/lib/character-version";
import { extractPattern } from "@/lib/pattern";
import type { DraftDoc } from "@/lib/types";

export const MAX_AGENT_DRAFTS = 5;
const PLATFORM_LIMITS = { x: 280, threads: 500 } as const;

export function normalizedDraftText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function draftTextWithHashtags(text: string, hashtags: string[] = []) {
  const tags = hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
  return [text.trim(), ...tags].filter(Boolean).join(" ");
}

export function trigramSimilarity(left: string, right: string) {
  const grams = (value: string) => {
    const normalized = `  ${normalizedDraftText(value)}  `;
    return new Set(Array.from({ length: Math.max(0, normalized.length - 2) }, (_, i) => normalized.slice(i, i + 3)));
  };
  const a = grams(left); const b = grams(right);
  if (!a.size && !b.size) return 1;
  let common = 0; a.forEach((gram) => { if (b.has(gram)) common += 1; });
  return (2 * common) / (a.size + b.size);
}

export type NewDraftInput = {
  text: string;
  hashtags?: string[];
  createdBy?: string;
  generatedBy?: string;
  overwriteSimilar?: boolean;
  affiliate?: { productId: string; creativeAssetId?: string };
  ownedContent?: { itemId: string };
};

export async function createAgentDrafts(
  accountId: string,
  expectedCharacterVersion: number,
  inputs: NewDraftInput[],
): Promise<DraftDoc[]> {
  if (inputs.length < 1 || inputs.length > 10) throw new Error("1〜10件の下書きを指定してください。");
  const accountRef = adminDb.collection("accounts").doc(accountId);
  return adminDb.runTransaction(async (transaction) => {
    const accountSnap = await transaction.get(accountRef);
    if (!accountSnap.exists) throw new Error("Account not found.");
    const account = accountSnap.data() ?? {};
    const version = getCharacterVersion(account);
    if (version !== expectedCharacterVersion) throw new Error("character_version conflict: regenerate from current account guidance.");
    const draftSnap = await transaction.get(adminDb.collection("drafts").where("target_account_id", "==", accountId));
    const usable = draftSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as DraftDoc)
      .filter((draft) => (draft.status === "draft" || draft.status === "scheduled") && (draft.character_version ?? 1) === version);
    if (usable.length + inputs.length > MAX_AGENT_DRAFTS) throw new Error(`Current character version inventory is capped at ${MAX_AGENT_DRAFTS}.`);
    const existing = draftSnap.docs.map((doc) => doc.data() as DraftDoc);
    const affiliateProductIds = Array.from(new Set(inputs.map((input) => input.affiliate?.productId?.trim().toUpperCase()).filter((value): value is string => Boolean(value))));
    for (const productId of affiliateProductIds) {
      const productSnap = await transaction.get(adminDb.collection("products").doc(productId));
      if (!productSnap.exists) throw new Error("Affiliate product not found: " + productId);
    }

    const ownedContentIds = Array.from(new Set(
      inputs
        .map((input) => input.ownedContent?.itemId?.trim())
        .filter((value): value is string => Boolean(value)),
    ));
    const ownedContentById = new Map<string, {
      itemId: string;
      sourceId: string;
      canonicalUrl: string;
      sourceType: "website" | "note" | "newsletter" | "other";
    }>();
    for (const itemId of ownedContentIds) {
      const itemSnap = await transaction.get(adminDb.collection("owned_content_items").doc(itemId));
      if (!itemSnap.exists) throw new Error("Owned content item not found: " + itemId);
      const item = itemSnap.data() ?? {};
      if (item.status !== "active") throw new Error("Owned content item is not active: " + itemId);
      const sourceId = String(item.source_id ?? "").trim();
      const canonicalUrl = String(item.canonical_url ?? "").trim();
      if (!sourceId || !canonicalUrl) throw new Error("Owned content item is missing source_id or canonical_url: " + itemId);
      if (Array.isArray(item.allowed_account_ids) && item.allowed_account_ids.length > 0 && !item.allowed_account_ids.includes(accountId)) {
        throw new Error("Owned content item is not allowed for this account: " + itemId);
      }

      const sourceSnap = await transaction.get(adminDb.collection("owned_content_sources").doc(sourceId));
      if (!sourceSnap.exists) throw new Error("Owned content source not found: " + sourceId);
      const source = sourceSnap.data() ?? {};
      if (source.status !== "active") throw new Error("Owned content source is not active: " + sourceId);
      if (Array.isArray(source.allowed_account_ids) && source.allowed_account_ids.length > 0 && !source.allowed_account_ids.includes(accountId)) {
        throw new Error("Owned content source is not allowed for this account: " + sourceId);
      }
      if (Array.isArray(source.allowed_platforms) && source.allowed_platforms.length > 0 && !source.allowed_platforms.includes(account.platform)) {
        throw new Error("Owned content source is not allowed on this platform: " + sourceId);
      }
      const sourceType = String(source.source_type ?? "") as "website" | "note" | "newsletter" | "other";
      if (!["website", "note", "newsletter", "other"].includes(sourceType)) {
        throw new Error("Owned content source has an unsupported source_type: " + sourceId);
      }
      ownedContentById.set(itemId, { itemId, sourceId, canonicalUrl, sourceType });
    }
    const now = DateTime.utc().toISO()!;
    const drafts = inputs.map((input) => {
      const text = input.text.trim(); const hashtags = input.hashtags ?? [];
      if (!text) throw new Error("Draft text is required.");
      if (input.affiliate && input.ownedContent) throw new Error("A draft cannot be both affiliate-product and owned-content distribution.");
      const fullText = draftTextWithHashtags(text, hashtags);
      const ownedContent = input.ownedContent ? ownedContentById.get(input.ownedContent.itemId.trim()) : undefined;
      if (input.ownedContent && !ownedContent) throw new Error("Owned content metadata could not be resolved.");
      if (ownedContent && !fullText.includes(ownedContent.canonicalUrl)) {
        throw new Error("Owned-content draft must contain the item's canonical_url.");
      }
      const min = typeof account.minPostLength === "number" ? account.minPostLength : 1;
      const configuredMax = typeof account.maxPostLength === "number" ? account.maxPostLength : PLATFORM_LIMITS[(account.platform ?? "x") as "x" | "threads"];
      const max = Math.min(configuredMax, PLATFORM_LIMITS[(account.platform ?? "x") as "x" | "threads"]);
      if (fullText.length < min || fullText.length > max) throw new Error(`Draft length must be ${min}–${max} characters including hashtags.`);
      const normalized = normalizedDraftText(fullText);
      const duplicate = existing.find((candidate) => normalizedDraftText(draftTextWithHashtags(candidate.text, candidate.hashtags)) === normalized);
      if (duplicate) throw new Error("An identical draft already exists.");
      const similar = existing.find((candidate) => trigramSimilarity(fullText, draftTextWithHashtags(candidate.text, candidate.hashtags)) >= 0.82);
      if (similar && !input.overwriteSimilar) throw new Error("A too-similar draft already exists; set overwriteSimilar only after reviewing it.");
      const ref = adminDb.collection("drafts").doc();
      const draft: DraftDoc = { id: ref.id, target_platform: account.platform as "x" | "threads", target_account_id: accountId, base_post_id: null, text, hashtags, status: "scheduled", schedule_time: null, published_at: null, created_by: input.createdBy ?? "agent", created_at: now, updated_at: now, similarity_warning: Boolean(similar), character_version: version, generatedBy: input.generatedBy ?? "agent", ...(input.affiliate ? { affiliate_product_id: input.affiliate.productId.trim().toUpperCase(), ...(input.affiliate.creativeAssetId?.trim() ? { affiliate_creative_id: input.affiliate.creativeAssetId.trim() } : {}) } : {}), ...(ownedContent ? { owned_content_item_id: ownedContent.itemId, owned_content_source_id: ownedContent.sourceId, owned_content_url: ownedContent.canonicalUrl, owned_content_source_type: ownedContent.sourceType } : {}), pattern: extractPattern(text) };
      transaction.set(ref, draft); existing.push(draft); return draft;
    });
    return drafts;
  });
}
