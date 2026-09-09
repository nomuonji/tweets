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

export type NewDraftInput = { text: string; hashtags?: string[]; createdBy?: string; generatedBy?: string; overwriteSimilar?: boolean };

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
    const now = DateTime.utc().toISO()!;
    const drafts = inputs.map((input) => {
      const text = input.text.trim(); const hashtags = input.hashtags ?? [];
      if (!text) throw new Error("Draft text is required.");
      const fullText = draftTextWithHashtags(text, hashtags);
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
      const draft: DraftDoc = { id: ref.id, target_platform: account.platform as "x" | "threads", target_account_id: accountId, base_post_id: null, text, hashtags, status: "scheduled", schedule_time: null, published_at: null, created_by: input.createdBy ?? "agent", created_at: now, updated_at: now, similarity_warning: Boolean(similar), character_version: version, generatedBy: input.generatedBy ?? "agent", pattern: extractPattern(text) };
      transaction.set(ref, draft); existing.push(draft); return draft;
    });
    return drafts;
  });
}
