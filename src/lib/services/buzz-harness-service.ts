import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getCharacterVersion } from "@/lib/character-version";
import { getUsableDraftsByAccountId } from "@/lib/services/firestore.server";
import type { AccountDoc, DraftDoc, ExternalPostDoc, PostDoc } from "@/lib/types";
import {
  BuzzHarnessPacketSchema,
  buzzDraftTextHash,
  buzzPacketHash,
  trigramSimilarity,
  validateBuzzHarnessPacket,
} from "@/lib/buzz-harness";

export interface BuzzHarnessAuthorization {
  runId: string;
  reportHash: string;
}

function sourceFingerprint(post: ExternalPostDoc) {
  return {
    id: post.id,
    platform: post.platform,
    platformPostId: post.platform_post_id,
    authorHandle: post.author_handle,
    textHash: buzzDraftTextHash(post.text),
    url: post.url ?? null,
    createdAt: post.created_at,
    fetchedAt: post.fetched_at,
    searchKeyword: post.search_keyword ?? null,
    discoveryMode: post.discovery_mode ?? null,
    engagementRate: post.engagement_rate ?? null,
    metrics: post.metrics,
  };
}

async function existingTexts(accountId: string): Promise<string[]> {
  const [posts, drafts] = await Promise.all([
    adminDb.collection("posts").where("account_id", "==", accountId).limit(100).get(),
    adminDb.collection("drafts").where("target_account_id", "==", accountId).limit(100).get(),
  ]);
  const postTexts = posts.docs.map((doc) => String((doc.data() as PostDoc).text ?? ""));
  const draftTexts = drafts.docs.map((doc) => String((doc.data() as DraftDoc).text ?? ""));
  return [...postTexts, ...draftTexts].filter(Boolean);
}

/**
 * A run becomes save-eligible only after the server reads the live account
 * characters and canonical external_posts documents, then validates the
 * packet against those records. The returned hash binds the approval to the
 * exact packet, source snapshots, character versions and final copy.
 */
export async function submitBuzzHarnessRun(rawPacket: unknown) {
  const parsed = BuzzHarnessPacketSchema.safeParse(rawPacket);
  if (!parsed.success) {
    return {
      status: "rejected" as const,
      runId: null,
      reportHash: null,
      errors: parsed.error.issues.map((issue) => \`\${issue.path.join(".")}: \${issue.message}\`),
      metrics: null,
    };
  }

  const packet = parsed.data;
  const runRef = adminDb.collection("buzz_harness_runs").doc(packet.runId);
  const existingRun = await runRef.get();
  if (existingRun.exists) {
    return {
      status: "rejected" as const,
      runId: packet.runId,
      reportHash: null,
      errors: ["runId already exists. Start a new run instead of overwriting an audit record."],
      metrics: null,
    };
  }

  const liveAccounts = new Map<string, {
    id: string;
    handle: string;
    platform: "x" | "threads";
    characterVersion: number;
    concept: string;
    neededDraftCount: number;
  }>();
  const liveAccountDocs = new Map<string, AccountDoc>();
  const existingTextsByAccount = new Map<string, string[]>();

  await Promise.all(packet.accounts.map(async (profile) => {
    const snap = await adminDb.collection("accounts").doc(profile.accountId).get();
    if (!snap.exists) return;
    const account = { id: snap.id, ...snap.data() } as AccountDoc;
    const version = getCharacterVersion(account);
    const usableDrafts = await getUsableDraftsByAccountId(profile.accountId, version);
    const neededDraftCount = Math.max(0, 5 - usableDrafts.length);
    liveAccounts.set(profile.accountId, {
      id: account.id,
      handle: account.handle,
      platform: account.platform,
      characterVersion: version,
      concept: account.concept ?? "",
      neededDraftCount,
    });
    liveAccountDocs.set(profile.accountId, account);
    existingTextsByAccount.set(profile.accountId, await existingTexts(profile.accountId));
  }));

  const sourceIds = Array.from(new Set(packet.observations.map((item) => item.externalPostId)));
  const sourcePosts = new Map<string, ExternalPostDoc>();
  await Promise.all(sourceIds.map(async (id) => {
    const snap = await adminDb.collection("external_posts").doc(id).get();
    if (snap.exists) sourcePosts.set(id, { id: snap.id, ...snap.data() } as ExternalPostDoc);
  }));

  const validation = validateBuzzHarnessPacket({
    packet,
    liveAccounts,
    sourcePosts,
    existingTextsByAccount,
  });

  // Require the server readback and the packet to agree on every final draft
  // target. A candidate-only packet cannot create a save permission.
  for (const draft of packet.drafts) {
    if (!liveAccountDocs.has(draft.accountId)) {
      validation.errors.push(\`No live account snapshot was available for draft target \${draft.accountId}.\`);
    }
  }
  validation.passed = validation.errors.length === 0;

  const createdAt = DateTime.utc().toISO()!;
  const sourceReceipts = sourceIds
    .map((id) => sourcePosts.get(id))
    .filter((post): post is ExternalPostDoc => Boolean(post))
    .map(sourceFingerprint)
    .sort((a, b) => a.id.localeCompare(b.id));
  const accountReceipts = Array.from(liveAccounts.values())
    .map((account) => ({
      accountId: account.id,
      handle: account.handle,
      platform: account.platform,
      characterVersion: account.characterVersion,
      conceptHash: buzzDraftTextHash(account.concept),
      neededDraftCount: account.neededDraftCount,
    }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
  const packetHash = buzzPacketHash(packet);
  const reportHash = buzzPacketHash({
    packetHash,
    sourceReceipts,
    accountReceipts,
    metrics: validation.metrics,
    errors: validation.errors,
  });
  const approvedDraftsByAccount: Record<string, Array<{
    textHash: string;
    candidateId: string;
    sourcePostIds: string[];
    characterVersion: number;
  }>> = {};

  if (validation.passed) {
    for (const draft of packet.drafts) {
      (approvedDraftsByAccount[draft.accountId] ??= []).push({
        textHash: buzzDraftTextHash(draft.text),
        candidateId: draft.candidateId,
        sourcePostIds: [...draft.sourcePostIds].sort(),
        characterVersion: draft.characterVersion,
      });
    }
  }

  await runRef.create({
    runId: packet.runId,
    schemaVersion: packet.schemaVersion,
    status: validation.passed ? "approved" : "rejected",
    reportHash,
    packetHash,
    writerId: packet.writerId,
    model: packet.model,
    createdAt,
    expiresAt: DateTime.utc().plus({ hours: 24 }).toISO(),
    errors: validation.errors,
    warnings: validation.warnings,
    metrics: validation.metrics,
    accountReceipts,
    sourceReceipts,
    approvedDraftsByAccount,
    consumedAccountIds: [],
  });

  return {
    status: validation.passed ? "approved" as const : "rejected" as const,
    runId: packet.runId,
    reportHash: validation.passed ? reportHash : null,
    errors: validation.errors,
    warnings: validation.warnings,
    metrics: validation.metrics,
    nextAction: validation.passed
      ? "Call create_drafts with this runId/reportHash, one account at a time, and the exact approved text plus provenance.externalPostIds, provenance.candidateId and provenance.buzzRunId. This approval expires in 24 hours. It never publishes."
      : "Do not save drafts. Fix the listed failures, create a new runId, and submit a new packet.",
  };
}

export function assertBuzzDraftSimilarityFree(text: string, existingTexts: string[]) {
  return !existingTexts.some((existing) => trigramSimilarity(text, existing) >= 0.82);
}
