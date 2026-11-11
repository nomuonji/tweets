import { createHash } from "node:crypto";
import { z } from "zod";
import type { ExternalPostDoc } from "@/lib/types";

const isoDate = z.string().datetime({ offset: true });
const shortText = z.string().trim().min(8).max(1200);
const sourceIds = z.array(z.string().trim().min(1).max(160)).min(1).max(12);
const passNote = z.object({
  pass: z.literal(true),
  note: z.string().trim().min(20).max(800),
});

const accountSchema = z.object({
  accountId: z.string().trim().min(1).max(160),
  handle: z.string().trim().min(1).max(200),
  platform: z.enum(["x", "threads"]),
  characterVersion: z.number().int().min(1),
  concept: z.string().trim().min(40).max(12000),
  capturedAt: isoDate,
  neededDraftCount: z.number().int().min(1).max(5),
});

const searchClusterSchema = z.object({
  id: z.string().trim().min(1).max(80),
  searchKeyword: z.string().trim().min(2).max(160),
  query: z.string().trim().min(4).max(500),
  acquisitionLane: z.enum(["Top", "Latest", "mixed"]),
  origin: z.enum(["seed_followup", "blind_discovery"]),
  sourcePostIds: sourceIds,
  observation: z.string().trim().min(30).max(1200),
});

const observationSchema = z.object({
  externalPostId: z.string().trim().min(1).max(160),
  clusterId: z.string().trim().min(1).max(80),
  whyItMatters: z.string().trim().min(30).max(1000),
});

const mechanismSchema = z.object({
  id: z.string().trim().min(1).max(80),
  sourcePostIds: sourceIds,
  audienceSituation: shortText,
  ordinaryReaction: shortText,
  attentionTrigger: shortText,
  immediateReward: shortText,
  socialUse: shortText,
  counterexample: z.string().trim().min(30).max(1000),
  transferableMechanism: shortText,
  transferContexts: z.array(shortText).min(2).max(6),
  confidence: z.enum(["low", "medium", "high"]),
});

const candidateSchema = z.object({
  id: z.string().trim().min(1).max(100),
  accountId: z.string().trim().min(1).max(160),
  mechanismId: z.string().trim().min(1).max(80),
  audienceMoment: shortText,
  ordinaryIdea: shortText,
  meaningfulShift: shortText,
  familiarFormat: shortText,
  hook: z.string().trim().min(8).max(300),
  immediateReward: shortText,
  shareReason: shortText,
  sourcePostIds: sourceIds,
  surfaceCopyChecked: z.literal(true),
});

const gateSetSchema = z.object({
  instantComprehension: passNote,
  recognizableSituation: passNote,
  immediateReward: passNote,
  lowCognitiveCost: passNote,
  concreteSocialUse: passNote,
});

const resonanceSetSchema = z.object({
  ordinaryBaseline: passNote,
  oneMeaningfulShift: passNote,
  familiarFormatReturn: passNote,
  counterexampleConsidered: passNote,
  notSurfaceCopied: passNote,
});

const editorialGateSchema = z.object({
  A_entryAndUnderstanding: passNote,
  B_specificCore: passNote,
  C_readerReward: passNote,
  D_shareOrConversationReason: passNote,
  E_voiceAndNaturalness: passNote,
  F_marketMechanismTransfer: passNote,
  G_factsRightsAndSafety: passNote,
});

const draftSchema = z.object({
  accountId: z.string().trim().min(1).max(160),
  characterVersion: z.number().int().min(1),
  candidateId: z.string().trim().min(1).max(100),
  mechanismId: z.string().trim().min(1).max(80),
  sourcePostIds: sourceIds,
  objective: z.enum(["reach", "sharing", "entertainment", "conversation", "utility"]),
  text: z.string().trim().min(20).max(500),
  hashtags: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  topicTag: z.string().trim().min(1).max(50).optional(),
  authoredAt: isoDate,
  bakaGate: gateSetSchema,
  resonanceGate: resonanceSetSchema,
  editorialGate: editorialGateSchema,
});

export const BuzzHarnessPacketSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-z0-9][a-z0-9_-]{7,79}$/i),
  writerId: z.string().trim().min(3).max(160),
  model: z.string().trim().min(2).max(160),
  createdAt: isoDate,
  initialSeed: z.string().trim().min(8).max(300),
  accounts: z.array(accountSchema).min(1).max(12),
  searchClusters: z.array(searchClusterSchema).min(3).max(12),
  observations: z.array(observationSchema).min(6).max(40),
  mechanisms: z.array(mechanismSchema).min(3).max(12),
  counterexamples: z.array(z.object({
    externalPostId: z.string().trim().min(1).max(160),
    whyThisContradictsOrLimitsThePattern: z.string().trim().min(30).max(1000),
  })).min(2).max(20),
  candidates: z.array(candidateSchema).min(15).max(100),
  drafts: z.array(draftSchema).min(1).max(40),
}).strict();

export type BuzzHarnessPacket = z.infer<typeof BuzzHarnessPacketSchema>;

export interface BuzzHarnessValidationInput {
  packet: BuzzHarnessPacket;
  liveAccounts: Map<string, {
    id: string;
    handle: string;
    platform: "x" | "threads";
    characterVersion: number;
    concept: string;
    neededDraftCount: number;
  }>;
  sourcePosts: Map<string, ExternalPostDoc>;
  existingTextsByAccount?: Map<string, string[]>;
}

export interface BuzzHarnessValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    accounts: number;
    postsObserved: number;
    uniqueAuthors: number;
    searchClusters: number;
    blindDiscoveryShare: number;
    mechanismFamilies: number;
    candidates: number;
    drafts: number;
    reactionBands: { high: number; typical: number; low: number };
  };
}

export interface BlindReviewReceiptInput {
  writerId: string;
  writerModel: string;
  reviewerId: string;
  reviewerModel: string;
  reviewerMode: "blind_copy_only";
  expectedTextHashes: string[];
  reviews: Array<{
    textHash: string;
    decision: "PASS";
    reviewedAt: string;
    note: string;
  }>;
}

export function validateBlindReviewReceipt(
  input: BlindReviewReceiptInput,
  nowMs = Date.now(),
): string[] {
  const errors: string[] = [];
  if (input.reviewerId.trim() === input.writerId.trim()) {
    errors.push("The blind reviewer identity must differ from the writer.");
  }
  if (input.reviewerModel.trim().toLowerCase() === input.writerModel.trim().toLowerCase()) {
    errors.push("The blind reviewer model must differ from the writer model.");
  }
  if (input.reviewerMode !== "blind_copy_only") {
    errors.push("The final review must be performed without the author's rationale.");
  }
  const expected = [...input.expectedTextHashes].sort();
  const reviews = [...input.reviews].sort((a, b) => a.textHash.localeCompare(b.textHash));
  const received = reviews.map((item) => item.textHash);
  if (expected.length === 0) errors.push("There are no final texts to review.");
  if (expected.length !== reviews.length || new Set(expected).size !== expected.length || new Set(received).size !== received.length) {
    errors.push("Every unique final text must receive exactly one independent review.");
  }
  if (JSON.stringify(expected) !== JSON.stringify(received)) {
    errors.push("The review receipt does not cover the exact final-copy hashes.");
  }
  for (const review of reviews) {
    const reviewedAt = Date.parse(review.reviewedAt);
    if (!Number.isFinite(reviewedAt) || reviewedAt > nowMs || nowMs - reviewedAt > 24 * 60 * 60 * 1000) {
      errors.push("Every review timestamp must be valid, recent and not future-dated.");
    }
    if (review.decision !== "PASS" || review.note.trim().length < 30) {
      errors.push("Every final text needs an explicit PASS and a substantive blind-review note.");
    }
  }
  return unique(errors);
}

export function normalizeForHash(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function buzzDraftTextHash(value: string): string {
  return createHash("sha256").update(normalizeForHash(value)).digest("hex");
}

export function buzzFinalCopy(text: string, hashtags: string[] = []): string {
  const tags = hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
  return [text.trim(), ...tags].filter(Boolean).join(" ");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function buzzPacketHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function buzzSourceReceipt(post: ExternalPostDoc) {
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

export function hasStatisticLedHook(value: string): boolean {
  const opening = value.slice(0, 110);
  return /(?:\d+(?:[.,]\d+)?\s*%|\d{2,}\s*(?:人|社|件|回|日|円|時間|分)|(?:調査|研究|統計|レポート|データ).{0,24}(?:では|によると|で判明|が示す))/.test(opening);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function allPassedNotes(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const notes = Object.values(value as Record<string, unknown>).map((entry) => {
    if (!entry || typeof entry !== "object") return "";
    const note = entry as { pass?: unknown; note?: unknown };
    return note.pass === true && typeof note.note === "string" && note.note.trim().length >= 40
      ? normalizeForHash(note.note).toLowerCase()
      : "";
  });
  // One boilerplate sentence reused across all rubric items is not evidence
  // that the writer inspected each dimension independently.
  return notes.length > 0 && notes.every(Boolean) && unique(notes).length === notes.length;
}

function withinDays(value: string | undefined, days: number, nowMs: number): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= nowMs && nowMs - time <= days * 86400000;
}

export function validateBuzzHarnessPacket(input: BuzzHarnessValidationInput): BuzzHarnessValidationResult {
  const { packet, liveAccounts, sourcePosts } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const nowMs = Date.now();

  const accountIds = packet.accounts.map((account) => account.accountId);
  if (unique(accountIds).length !== accountIds.length) errors.push("Account profiles contain duplicate accountId values.");
  if (unique(packet.searchClusters.map((cluster) => cluster.id)).length !== packet.searchClusters.length) errors.push("Search-cluster IDs must be unique.");
  if (unique(packet.observations.map((item) => item.externalPostId)).length !== packet.observations.length) errors.push("Each external post may appear only once in the observation sample.");
  if (unique(packet.mechanisms.map((item) => item.id)).length !== packet.mechanisms.length) errors.push("Mechanism IDs must be unique.");
  if (unique(packet.candidates.map((item) => item.id)).length !== packet.candidates.length) errors.push("Candidate IDs must be unique.");

  const clusterById = new Map(packet.searchClusters.map((cluster) => [cluster.id, cluster]));
  const observationIds = new Set(packet.observations.map((item) => item.externalPostId));
  const mechanismById = new Map(packet.mechanisms.map((item) => [item.id, item]));
  const candidateById = new Map(packet.candidates.map((item) => [item.id, item]));
  const mechanismFamilies = unique(packet.mechanisms.map((item) => item.transferableMechanism.toLowerCase()));

  const blindClusters = packet.searchClusters.filter((cluster) => cluster.origin === "blind_discovery").length;
  if (blindClusters < Math.ceil(packet.searchClusters.length * 0.3)) {
    errors.push("At least 30% of discovery clusters must be marked blind_discovery, not just extensions of the initial seed.");
  }

  for (const profile of packet.accounts) {
    const live = liveAccounts.get(profile.accountId);
    if (!live) {
      errors.push(`Account ${profile.accountId} has no live readback.`);
      continue;
    }
    if (live.handle !== profile.handle || live.platform !== profile.platform) errors.push(`Account ${profile.accountId} handle/platform differs from the live readback.`);
    if (live.characterVersion !== profile.characterVersion) errors.push(`Account ${profile.accountId} characterVersion is stale.`);
    if (live.concept !== profile.concept) errors.push(`Account ${profile.accountId} concept snapshot differs from the live account.`);
    if (live.neededDraftCount !== profile.neededDraftCount) errors.push(`Account ${profile.accountId} draft inventory is stale; refresh get_generation_work.`);
    if (!withinDays(profile.capturedAt, 1, nowMs)) errors.push(`Account ${profile.accountId} profile snapshot is older than 24 hours or is future-dated.`);
  }

  const authors: string[] = [];
  const searchKeywords: string[] = [];
  const discoveryModes: string[] = [];
  const engagementRates: Array<{ id: string; rate: number }> = [];
  let blindObservationCount = 0;

  for (const observation of packet.observations) {
    const cluster = clusterById.get(observation.clusterId);
    if (!cluster) {
      errors.push(`Observation ${observation.externalPostId} references an unknown cluster.`);
      continue;
    }
    const post = sourcePosts.get(observation.externalPostId);
    if (!post) {
      errors.push(`External post ${observation.externalPostId} is not present in the canonical external_posts collection.`);
      continue;
    }
    if (post.platform !== "x" || !post.text?.trim() || !post.url?.startsWith("https://")) errors.push(`External post ${observation.externalPostId} is missing a canonical X URL or text snapshot.`);
    if (!post.author_handle?.trim()) errors.push(`External post ${observation.externalPostId} has no author handle.`);
    if (post.search_keyword?.trim().toLowerCase() !== cluster.searchKeyword.trim().toLowerCase()) errors.push(`External post ${observation.externalPostId} was not retrieved under its claimed search keyword.`);
    if (!post.discovery_mode || !["Top", "Latest"].includes(post.discovery_mode)) errors.push(`External post ${observation.externalPostId} has no verified Top/Latest acquisition lane.`);
    if (typeof post.engagement_rate !== "number" || !Number.isFinite(post.engagement_rate) || post.engagement_rate < 0) errors.push(`External post ${observation.externalPostId} has no measured follower-relative engagement signal; do not invent a reaction band.`);
    else engagementRates.push({ id: observation.externalPostId, rate: post.engagement_rate });
    if (!withinDays(post.fetched_at, 30, nowMs)) errors.push(`External post ${observation.externalPostId} was not fetched within the last 30 days.`);
    if (!withinDays(post.created_at, 365, nowMs)) errors.push(`External post ${observation.externalPostId} is older than 365 days; use a current sample or explicitly research a historical format separately.`);
    if (post.author_handle) authors.push(post.author_handle.toLowerCase());
    if (post.search_keyword) searchKeywords.push(post.search_keyword.toLowerCase());
    if (post.discovery_mode) discoveryModes.push(post.discovery_mode);
    if (cluster.origin === "blind_discovery") blindObservationCount += 1;
  }

  if (authors.length < 4 || unique(authors).length < 4) errors.push("The corpus must contain at least 6 posts from at least 4 distinct authors.");
  if (unique(searchKeywords).length < 3) errors.push("The corpus must span at least 3 independently searched keywords/clusters.");
  if (!discoveryModes.includes("Top") || !discoveryModes.includes("Latest")) errors.push("The sample must include both Top and Latest acquisition lanes.");
  if (blindObservationCount < Math.ceil(packet.observations.length * 0.3)) errors.push("At least 30% of observed posts must come from blind-discovery clusters.");
  if (engagementRates.length >= 6 && unique(engagementRates).length < 3) errors.push("The observed engagement signals do not provide enough variation to compare strong, typical and weak examples.");

  const sortedRates = [...engagementRates].sort((a, b) => a.rate - b.rate);
  const lowCount = sortedRates.length >= 6 ? Math.max(1, Math.ceil(sortedRates.length * 0.25)) : 0;
  const highCount = sortedRates.length >= 6 ? Math.max(1, Math.ceil(sortedRates.length * 0.25)) : 0;
  const lowReactionIds = new Set(sortedRates.slice(0, lowCount).map((item) => item.id));
  const highReactionIds = new Set(sortedRates.slice(Math.max(0, sortedRates.length - highCount)).map((item) => item.id));
  const reactionBands = {
    low: lowReactionIds.size,
    high: highReactionIds.size,
    typical: Math.max(0, sortedRates.length - lowReactionIds.size - highReactionIds.size),
  };
  if (sortedRates.length >= 6 && !packet.counterexamples.some((item) => lowReactionIds.has(item.externalPostId))) {
    errors.push("At least one counterexample must come from an observed post in the lowest quartile of measured follower-relative engagement.");
  }
  if (sortedRates.length >= 6 && !packet.observations.some((item) => highReactionIds.has(item.externalPostId))) {
    errors.push("The corpus has no verified high-reaction example in its upper quartile.");
  }
  if (packet.observations.length < 6 || packet.observations.length > 40) errors.push("The market corpus needs at least 6 actual posts.");
  if (packet.searchClusters.some((cluster) => cluster.sourcePostIds.some((id) => !observationIds.has(id)))) errors.push("A search cluster references a post that is not in the observed corpus.");
  for (const cluster of packet.searchClusters) {
    if (!packet.observations.some((item) => item.clusterId === cluster.id)) errors.push(`Search cluster ${cluster.id} has no linked observation.`);
    for (const sourceId of cluster.sourcePostIds) {
      const observation = packet.observations.find((item) => item.externalPostId === sourceId);
      if (observation && observation.clusterId !== cluster.id) {
        errors.push(`Search cluster ${cluster.id} claims post ${sourceId}, but its observation is assigned to ${observation.clusterId}.`);
      }
    }
    const observedModes = cluster.sourcePostIds
      .map((id) => sourcePosts.get(id)?.discovery_mode)
      .filter((mode): mode is "Top" | "Latest" => mode === "Top" || mode === "Latest");
    if (cluster.acquisitionLane === "Top" && !observedModes.includes("Top")) {
      errors.push(`Search cluster ${cluster.id} claims Top but its canonical posts contain no Top result.`);
    }
    if (cluster.acquisitionLane === "Latest" && !observedModes.includes("Latest")) {
      errors.push(`Search cluster ${cluster.id} claims Latest but its canonical posts contain no Latest result.`);
    }
    if (cluster.acquisitionLane === "mixed" && (!observedModes.includes("Top") || !observedModes.includes("Latest"))) {
      errors.push(`Search cluster ${cluster.id} claims mixed acquisition but is missing a Top or Latest canonical post.`);
    }
  }

  if (packet.mechanisms.length < 3 || mechanismFamilies.length < 3) errors.push("At least 3 distinct response mechanisms must be extracted.");
  for (const mechanism of packet.mechanisms) {
    if (mechanism.sourcePostIds.some((id) => !observationIds.has(id))) errors.push(`Mechanism ${mechanism.id} cites an unobserved post.`);
  }
  for (const counterexample of packet.counterexamples) {
    if (!observationIds.has(counterexample.externalPostId)) errors.push(`Counterexample ${counterexample.externalPostId} is not backed by a captured external post.`);
  }

  if (packet.candidates.length < 15) errors.push("The divergence stage must contain at least 15 distinct candidate concepts before selection.");
  const candidateFamilies = unique(packet.candidates.map((candidate) => candidate.mechanismId));
  if (candidateFamilies.length < 3) errors.push("Candidate concepts must come from at least 3 different mechanism families.");
  for (const candidate of packet.candidates) {
    if (!liveAccounts.has(candidate.accountId)) errors.push(`Candidate ${candidate.id} targets an account that was not read back live.`);
    if (!mechanismById.has(candidate.mechanismId)) errors.push(`Candidate ${candidate.id} references an unknown mechanism.`);
    if (candidate.sourcePostIds.some((id) => !observationIds.has(id))) errors.push(`Candidate ${candidate.id} cites a post outside the verified corpus.`);
    const mechanism = mechanismById.get(candidate.mechanismId);
    if (mechanism && !candidate.sourcePostIds.some((id) => mechanism.sourcePostIds.includes(id))) {
      errors.push(`Candidate ${candidate.id} does not cite evidence from its assigned mechanism.`);
    }
    if (candidate.surfaceCopyChecked !== true) errors.push(`Candidate ${candidate.id} has not passed the surface-copy check.`);
  }
  const candidateBodies = packet.candidates.map((candidate) => ({
    id: candidate.id,
    body: [candidate.audienceMoment, candidate.ordinaryIdea, candidate.meaningfulShift, candidate.familiarFormat, candidate.hook].join(" "),
  }));
  for (let i = 0; i < candidateBodies.length; i += 1) {
    for (let j = i + 1; j < candidateBodies.length; j += 1) {
      const similarity = trigramSimilarity(candidateBodies[i].body, candidateBodies[j].body);
      if (similarity >= 0.72) {
        errors.push(`Candidates ${candidateBodies[i].id} and ${candidateBodies[j].id} are surface-similar (${similarity.toFixed(2)}); diverge the concepts, not only the labels.`);
      }
    }
  }

  const draftCounts = new Map<string, number>();
  const usedCandidateIds = new Set<string>();
  const draftTextsByAccount = new Map<string, string[]>();
  for (const draft of packet.drafts) {
    const profile = packet.accounts.find((item) => item.accountId === draft.accountId);
    if (!profile) errors.push(`Draft references account ${draft.accountId} without a current profile snapshot.`);
    else {
      if (draft.characterVersion !== profile.characterVersion) errors.push(`Draft for ${draft.accountId} uses a stale character version.`);
      draftCounts.set(draft.accountId, (draftCounts.get(draft.accountId) ?? 0) + 1);
    }
    const candidate = candidateById.get(draft.candidateId);
    if (!candidate || candidate.accountId !== draft.accountId) errors.push(`Draft ${draft.candidateId} is not linked to a candidate for the same account.`);
    if (usedCandidateIds.has(draft.candidateId)) errors.push(`Candidate ${draft.candidateId} was reused by more than one final draft.`);
    usedCandidateIds.add(draft.candidateId);
    if (draft.mechanismId !== candidate?.mechanismId || !mechanismById.has(draft.mechanismId)) errors.push(`Draft ${draft.candidateId} has an inconsistent mechanism attribution.`);
    if (draft.sourcePostIds.some((id) => !observationIds.has(id))) errors.push(`Draft ${draft.candidateId} cites an unverified source post.`);
    if (draft.sourcePostIds.some((id) => !candidate?.sourcePostIds.includes(id))) errors.push(`Draft ${draft.candidateId} uses source posts not present in its originating candidate.`);
    if (hasStatisticLedHook(draft.text)) errors.push(`Draft ${draft.candidateId} leads with statistics/research. Numbers may support a post, but may not replace the human hook.`);
    if (!allPassedNotes(draft.bakaGate)) errors.push(`Draft ${draft.candidateId} did not pass every Baka Model gate with a written reason.`);
    if (!allPassedNotes(draft.resonanceGate)) errors.push(`Draft ${draft.candidateId} did not pass every Idea Resonance gate with a written reason.`);
    if (!allPassedNotes(draft.editorialGate)) errors.push(`Draft ${draft.candidateId} did not pass every Social Post Quality Gate with a written reason.`);
    const texts = draftTextsByAccount.get(draft.accountId) ?? [];
    texts.push(draft.text);
    draftTextsByAccount.set(draft.accountId, texts);
  }

  for (const profile of packet.accounts) {
    const count = draftCounts.get(profile.accountId) ?? 0;
    if (count < 1) errors.push(`Account ${profile.accountId} has no passing final draft; omit it from this run rather than claiming a completed batch.`);
    if (count > profile.neededDraftCount) errors.push(`Account ${profile.accountId} exceeds its current draft inventory gap.`);
  }

  for (const [accountId, newTexts] of draftTextsByAccount) {
    const existing = input.existingTextsByAccount?.get(accountId) ?? [];
    const prior = [...existing];
    for (let i = 0; i < newTexts.length; i += 1) {
      for (const oldText of prior) {
        const similarity = trigramSimilarity(newTexts[i], oldText);
        if (similarity >= 0.82) errors.push(`Draft for ${accountId} is too similar to an existing post/draft (similarity ${similarity.toFixed(2)}).`);
      }
      for (let j = i + 1; j < newTexts.length; j += 1) {
        const similarity = trigramSimilarity(newTexts[i], newTexts[j]);
        if (similarity >= 0.82) errors.push(`Two drafts for ${accountId} are too similar to each other (similarity ${similarity.toFixed(2)}).`);
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors: unique(errors),
    warnings,
    metrics: {
      accounts: packet.accounts.length,
      postsObserved: packet.observations.length,
      uniqueAuthors: unique(authors).length,
      searchClusters: packet.searchClusters.length,
      blindDiscoveryShare: packet.observations.length ? blindObservationCount / packet.observations.length : 0,
      mechanismFamilies: mechanismFamilies.length,
      candidates: packet.candidates.length,
      drafts: packet.drafts.length,
      reactionBands,
    },
  };
}

export function trigramSimilarity(left: string, right: string): number {
  const grams = (value: string) => {
    const normalized = `  ${normalizeForHash(value).toLowerCase()}  `;
    return new Set(Array.from({ length: Math.max(0, normalized.length - 2) }, (_, index) => normalized.slice(index, index + 3)));
  };
  const a = grams(left);
  const b = grams(right);
  if (!a.size && !b.size) return 1;
  let common = 0;
  a.forEach((gram) => { if (b.has(gram)) common += 1; });
  return (2 * common) / (a.size + b.size);
}
