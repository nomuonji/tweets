import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getCharacterVersion } from "@/lib/character-version";
import { extractPattern } from "@/lib/pattern";
import { normalizeThreadsTopicTag } from "@/lib/threads-topic-tag";
import type { DraftDoc, DraftProvenance } from "@/lib/types";
import type { BuzzHarnessAuthorization } from "@/lib/services/buzz-harness-service";
import { buzzDraftTextHash } from "@/lib/buzz-harness";

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
  /** Optional Threads topic tag; stored separately from hashtags. */
  topicTag?: string;
  /** 型/ネタ attribution for later analysis. Optional for manual drafts. */
  provenance?: DraftProvenance;
};

export async function createAgentDrafts(
  accountId: string,
  expectedCharacterVersion: number,
  inputs: NewDraftInput[],
  harnessAuthorization?: BuzzHarnessAuthorization,
): Promise<DraftDoc[]> {
  if (!harnessAuthorization?.runId || !/^[a-f0-9]{64}$/.test(harnessAuthorization.reportHash)) {
    throw new Error("A passed Buzz Harness runId/reportHash is mandatory. Draft saving without an approved editorial evidence packet is blocked.");
  }
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
    // The harness record is written only by submit_buzz_harness_run after live
    // account + canonical external-post readback and all editorial gates pass.
    // Bind this save to the exact approved text hashes; no edits after review.
    const harnessRef = adminDb.collection("buzz_harness_runs").doc(harnessAuthorization.runId);
    const harnessSnap = await transaction.get(harnessRef);
    if (!harnessSnap.exists) throw new Error("Buzz Harness approval not found.");
    const harness = harnessSnap.data() ?? {};
    if (harness.reportHash !== harnessAuthorization.reportHash) throw new Error("Buzz Harness reportHash mismatch.");
    if (!["approved", "partially_consumed"].includes(String(harness.status))) throw new Error("Buzz Harness approval is not save-eligible.");
    if (Date.parse(String(harness.expiresAt ?? "")) <= Date.now()) throw new Error("Buzz Harness approval expired; rerun the evidence and review stages.");
    const consumedAccountIds = Array.isArray(harness.consumedAccountIds) ? harness.consumedAccountIds as string[] : [];
    if (consumedAccountIds.includes(accountId)) throw new Error("This account has already consumed its drafts from the approved Buzz Harness run.");
    const approvedDraftsByAccount = (harness.approvedDraftsByAccount ?? {}) as Record<string, Array<{ textHash: string; candidateId: string; sourcePostIds: string[]; characterVersion: number }>>;
    const approvedForAccount = approvedDraftsByAccount[accountId];
    if (!Array.isArray(approvedForAccount) || approvedForAccount.length !== inputs.length) {
      throw new Error("Draft count does not match the Buzz Harness approval for this account.");
    }
    const accountReceipt = Array.isArray(harness.accountReceipts)
      ? (harness.accountReceipts as Array<{ accountId?: string; handle?: string; platform?: string; characterVersion?: number; conceptHash?: string }>).find((item) => item.accountId === accountId)
      : undefined;
    if (
      !accountReceipt ||
      accountReceipt.characterVersion !== version ||
      version !== expectedCharacterVersion ||
      accountReceipt.handle !== account.handle ||
      accountReceipt.platform !== account.platform ||
      accountReceipt.conceptHash !== buzzDraftTextHash(String(account.concept ?? ""))
    ) {
      throw new Error("Buzz Harness account/character receipt is stale or the live persona changed. Rerun research and review.");
    }
    const expectedByHash = new Map(approvedForAccount.map((item) => [item.textHash, item]));
    for (const input of inputs) {
      const textHash = buzzDraftTextHash(input.text);
      const approved = expectedByHash.get(textHash);
      if (!approved) throw new Error("Draft text was edited after its Buzz Harness review or was not approved.");
      if (approved.characterVersion !== version) throw new Error("Approved draft character version does not match the live account.");
      if (input.provenance?.buzzRunId !== harnessAuthorization.runId) throw new Error("Draft provenance must reference the approving Buzz Harness run.");
      if (input.provenance?.candidateId !== approved.candidateId) throw new Error("Draft candidateId does not match the approving Buzz Harness run.");
      const actualSources = [...(input.provenance?.externalPostIds ?? [])].sort();
      const approvedSources = [...approved.sourcePostIds].sort();
      if (JSON.stringify(actualSources) !== JSON.stringify(approvedSources)) {
        throw new Error("Draft externalPostIds do not match the research sources approved by the Buzz Harness.");
      }
      expectedByHash.delete(textHash);
    }
    if (expectedByHash.size > 0) throw new Error("One or more approved drafts were omitted from this account save.");

    const now = DateTime.utc().toISO()!;
    const drafts = inputs.map((input) => {
      const text = input.text.trim(); const hashtags = input.hashtags ?? [];
      if (!text) throw new Error("Draft text is required.");
      if (input.topicTag !== undefined && account.platform !== "threads") {
        throw new Error("topicTag is only supported for Threads drafts.");
      }
      const topicTag = input.topicTag === undefined
        ? undefined
        : normalizeThreadsTopicTag(input.topicTag);
      if (input.topicTag !== undefined && !topicTag) {
        throw new Error("Threads topicTag must be 1–50 characters and cannot contain periods or ampersands.");
      }
      if (input.affiliate && input.ownedContent) throw new Error("A draft cannot be both affiliate-product and owned-content distribution.");
      const fullText = draftTextWithHashtags(text, hashtags);
      const ownedContent = input.ownedContent ? ownedContentById.get(input.ownedContent.itemId.trim()) : undefined;
      if (input.ownedContent && !ownedContent) throw new Error("Owned content metadata could not be resolved.");
      if (ownedContent && !fullText.includes(ownedContent.canonicalUrl)) {
        throw new Error("Owned-content draft must contain the item's canonical_url.");
      }
      // Unset (null/0) means "no limit"; the platform ceiling is always enforced.
      const platformLimit = PLATFORM_LIMITS[(account.platform ?? "x") as "x" | "threads"];
      const min =
        typeof account.minPostLength === "number" && account.minPostLength > 0
          ? account.minPostLength
          : 0;
      const configuredMax =
        typeof account.maxPostLength === "number" && account.maxPostLength > 0
          ? account.maxPostLength
          : platformLimit;
      const max = Math.min(configuredMax, platformLimit);
      if (fullText.length < min || fullText.length > max) {
        throw new Error(
          min > 0
            ? `Draft length must be ${min}–${max} characters including hashtags.`
            : `Draft length must be at most ${max} characters including hashtags.`,
        );
      }
      const normalized = normalizedDraftText(fullText);
      const duplicate = existing.find((candidate) => normalizedDraftText(draftTextWithHashtags(candidate.text, candidate.hashtags)) === normalized);
      if (duplicate) throw new Error("An identical draft already exists.");
      const similar = existing.find((candidate) => trigramSimilarity(fullText, draftTextWithHashtags(candidate.text, candidate.hashtags)) >= 0.82);
      if (similar && !input.overwriteSimilar) throw new Error("A too-similar draft already exists; set overwriteSimilar only after reviewing it.");
      const ref = adminDb.collection("drafts").doc();
      const draft: DraftDoc = { id: ref.id, target_platform: account.platform as "x" | "threads", target_account_id: accountId, base_post_id: null, text, hashtags, status: "scheduled", schedule_time: null, published_at: null, created_by: input.createdBy ?? "agent", created_at: now, updated_at: now, similarity_warning: Boolean(similar), character_version: version, generatedBy: input.generatedBy ?? "agent", ...(topicTag ? { topic_tag: topicTag } : {}), ...(input.affiliate ? { affiliate_product_id: input.affiliate.productId.trim().toUpperCase(), ...(input.affiliate.creativeAssetId?.trim() ? { affiliate_creative_id: input.affiliate.creativeAssetId.trim() } : {}) } : {}), ...(ownedContent ? { owned_content_item_id: ownedContent.itemId, owned_content_source_id: ownedContent.sourceId, owned_content_url: ownedContent.canonicalUrl, owned_content_source_type: ownedContent.sourceType } : {}), pattern: extractPattern(text), ...(input.provenance ? { provenance: input.provenance } : {}) };
      transaction.set(ref, draft); existing.push(draft); return draft;
    });
    const updatedConsumed = [...consumedAccountIds, accountId];
    const approvedAccountIds = Object.keys(approvedDraftsByAccount);
    const fullyConsumed = approvedAccountIds.every((id) => updatedConsumed.includes(id));
    transaction.update(harnessRef, {
      consumedAccountIds: updatedConsumed,
      status: fullyConsumed ? "consumed" : "partially_consumed",
      updatedAt: now,
    });
    return drafts;
  });
}
