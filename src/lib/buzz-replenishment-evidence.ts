/**
 * Canonical, deterministic evidence preflight for the Agent HQ Threads writer.
 * Blind discovery stays independent; production selection combines it with only
 * the target account's own keyword receipts. This function
 * NEVER writes drafts or pretends that a research packet passed editorial review.
 */
import { createHash } from "node:crypto";
import type { ExternalPostDoc, ExternalPostObservationDoc } from "@/lib/types";

export type VerifiedEvidence = {
  post: ExternalPostDoc;
  receipt: ExternalPostObservationDoc;
};
export type EvidenceSelection = {
  sources: VerifiedEvidence[];
  clusters: Array<{
    id: string;
    origin: "blind_discovery" | "seed_followup";
    discoveryQueryId: string;
    searchKeyword: string;
    acquisitionLane: "Top" | "Latest" | "mixed";
    sourcePostIds: string[];
  }>;
  metrics: {
    observations: number;
    authors: number;
    clusters: number;
    blindObservations: number;
    blindClusters: number;
    targetKeywordObservations: number;
    top: number;
    latest: number;
    lowReactionIds: string[];
    highReactionIds: string[];
  };
  reason?: string;
};

const DAY = 86_400_000;
function within(value: string | undefined, days: number, nowMs: number): boolean {
  const at = Date.parse(value ?? "");
  return Number.isFinite(at) && at <= nowMs && nowMs - at <= days * DAY;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Read-only origin validation: receipts are append-only collector evidence. */
export function verifyEvidenceSources(
  receipts: ExternalPostObservationDoc[],
  sourcePosts: ReadonlyMap<string, ExternalPostDoc>,
  nowMs = Date.now(),
): { verified: VerifiedEvidence[]; rejected: Record<string, number> } {
  const rejected: Record<string, number> = {};
  const verified: VerifiedEvidence[] = [];
  const seen = new Set<string>();
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  // Newest receipt first; a post is used in only one cluster.
  for (const receipt of [...receipts].sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))) {
    if (!["blind_discovery", "account_keyword"].includes(receipt.discovery_origin)) {
      reject("unsupported_origin"); continue;
    }
    if (!within(receipt.fetched_at, 30, nowMs) || !within(receipt.created_at, 365, nowMs)) {
      reject("stale"); continue;
    }
    const post = sourcePosts.get(receipt.external_post_id);
    if (!post) { reject("missing_post"); continue; }
    if (
      post.platform !== "x" || !post.text?.trim() ||
      !post.url?.startsWith("https://") || !post.author_handle?.trim() ||
      !receipt.discovery_query_id?.trim() || !receipt.search_keyword?.trim() ||
      !receipt.run_id?.trim() ||
      !["Top", "Latest"].includes(receipt.discovery_mode) ||
      receipt.platform_post_id !== post.platform_post_id ||
      receipt.canonical_url !== post.url ||
      receipt.author_handle.toLowerCase() !== post.author_handle.toLowerCase() ||
      receipt.text_hash !== hash(post.text)
    ) { reject("identity_or_text_hash_mismatch"); continue; }
    if (typeof post.engagement_rate !== "number" || !Number.isFinite(post.engagement_rate) || post.engagement_rate < 0) {
      reject("missing_measured_engagement"); continue;
    }
    if (receipt.discovery_origin === "blind_discovery") {
      if (receipt.collector_version !== "blind-discovery-v1" || receipt.source_type !== "account_independent_query") {
        reject("unverified_blind_origin"); continue;
      }
    } else if (
      receipt.collector_version !== "external-discovery-v2" ||
      receipt.source_type !== "account_keyword_query" ||
      receipt.discovery_query_id !== post.discovery_query_id ||
      receipt.search_keyword.trim().toLowerCase() !== post.search_keyword?.trim().toLowerCase() ||
      post.discovery_origin !== "account_keyword"
    ) {
      reject("unverified_keyword_origin"); continue;
    }
    if (seen.has(post.id)) { reject("duplicate_post"); continue; }
    seen.add(post.id);
    verified.push({ post, receipt });
  }
  return { verified, rejected };
}

function key(item: VerifiedEvidence) {
  return item.receipt.discovery_origin + "|" + item.receipt.discovery_query_id;
}

// Collection provenance is not semantic relevance. For plain Japanese
// keyword queries, prefer actual query-term overlap before engagement.
// Structured X queries and other languages remain unmodified.
function topicOverlap(item: VerifiedEvidence): number {
  if (item.receipt.discovery_origin !== "account_keyword") return 0;
  const query = item.receipt.search_keyword.normalize("NFKC").trim();
  if (!/[ぁ-んァ-ヶ一-龯]/.test(query) || /[":()]/.test(query)) return 0;
  const terms = Array.from(new Set(query.split(/\s+/).filter(term => term.length >= 2)));
  if (terms.length < 2) return 0;
  const body = item.post.text.normalize("NFKC").replace(/https?:\/\/\S+/g, "");
  return terms.filter(term => body.includes(term)).length / terms.length;
}

function isExplicitPromotion(text: string): boolean {
  return /(?:【\s*(?:広告|PR|宣伝|アフィリエイト)(?:[】・：:\s])|(?:^|\s)#(?:PR|広告|アフィリエイト)(?:\s|$))/i.test(text);
}

function evidenceTextKey(text: string): string {
  return text.normalize("NFKC").replace(/https?:\/\/\S+/g, "").replace(/[\s、。！？!?.,，．「」『』（）()【】…・:：;；"'“”‘’—〜～-]/g, "").toLowerCase();
}

export function selectResearchEvidence(
  verified: VerifiedEvidence[],
  limit = 15,
  targetAccountId?: string,
  options: { requireAccountKeywordEvidence?: boolean } = {},
): EvidenceSelection {
  const grouped = new Map<string, VerifiedEvidence[]>();
  for (const item of verified) {
    // A valid immutable receipt proves that a URL was collected, not that the
    // captured post contains words that can support a reader-facing idea.
    // Keep the receipt in the audit corpus, but never select a URL-only post
    // as one of the six evidence-bearing observations for authoring.
    if (!item.post.text.replace(/https?:\/\/\S+/g, "").trim() || isExplicitPromotion(item.post.text)) continue;
    // Never assign a different account's keyword research to this persona.
    if (targetAccountId && item.receipt.discovery_origin === "account_keyword" && item.receipt.target_account_id !== targetAccountId) continue;
    const id = key(item);
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  }
  // Prioritize real corpus breadth, separate authors and both acquisition modes.
  const ranked = Array.from(grouped.values()).sort((a, b) => {
    const score = (items: VerifiedEvidence[]) =>
      new Set(items.map(x => x.post.author_handle.toLowerCase())).size * 3 +
      (new Set(items.map(x => x.receipt.discovery_mode)).size === 2 ? 6 : 0) +
      Math.min(items.length, 12);
    const relevance = (items: VerifiedEvidence[]) => Math.max(...items.map(topicOverlap));
    return relevance(b) - relevance(a) || score(b) - score(a) ||
      (a[0].receipt.discovery_query_id.localeCompare(b[0].receipt.discovery_query_id));
  });
  const blind = ranked.filter(g => g[0].receipt.discovery_origin === "blind_discovery");
  const keyword = ranked.filter(g => g[0].receipt.discovery_origin === "account_keyword");
  // Two independent clusters out of five leave enough room for three
  // persona-specific clusters while preserving the independent 30% gate.
  // Sparse target evidence is supplemented with genuinely independent groups.
  const groups = targetAccountId && blind.length >= 2
    ? [...blind.slice(0, 2), ...keyword.slice(0, 3)]
    : [...blind.slice(0, 3), ...keyword.slice(0, 2)];
  // When an acquisition lane is sparse, select more independent groups instead
  // of relabeling account-scoped evidence as blind research.
  for (const group of ranked) {
    if (groups.length >= 5) break;
    if (!groups.includes(group)) groups.push(group);
  }

  const sources: VerifiedEvidence[] = [];
  const clusters: EvidenceSelection["clusters"] = [];
  const capped = Math.min(Math.max(6, limit), 30);
  const chosenTexts = new Set<string>();
  for (const group of groups) {
    const byRate = [...group].sort((a, b) =>
      topicOverlap(b) - topicOverlap(a) || (b.post.engagement_rate ?? 0) - (a.post.engagement_rate ?? 0));
    const top = byRate.find(x => x.receipt.discovery_mode === "Top");
    const latest = [...group].filter(x => x.receipt.discovery_mode === "Latest")
      .sort((a, b) => topicOverlap(b) - topicOverlap(a) || b.receipt.fetched_at.localeCompare(a.receipt.fetched_at))[0];
    const low = [...group].sort((a, b) => topicOverlap(b) - topicOverlap(a) ||
      (a.post.engagement_rate ?? 0) - (b.post.engagement_rate ?? 0))[0];
    const choices = [top, latest, low, ...byRate].filter((x): x is VerifiedEvidence => Boolean(x));
    const chosen: VerifiedEvidence[] = [];
    for (const item of choices) {
      if (chosen.length >= 3 || sources.length + chosen.length >= capped) break;
      const normalized = evidenceTextKey(item.post.text);
      if (!normalized || chosenTexts.has(normalized) || chosen.some(x => x.post.id === item.post.id)) continue;
      chosen.push(item);
      chosenTexts.add(normalized);
    }
    if (chosen.length === 0) continue;
    sources.push(...chosen);
    const receipt = group[0].receipt;
    const modes = new Set(chosen.map(x => x.receipt.discovery_mode));
    clusters.push({
      id: "cl_" + hash(key(group[0])).slice(0, 14),
      origin: receipt.discovery_origin === "blind_discovery" ? "blind_discovery" : "seed_followup",
      discoveryQueryId: receipt.discovery_query_id,
      searchKeyword: receipt.search_keyword,
      acquisitionLane: modes.size === 2 ? "mixed" : chosen[0].receipt.discovery_mode as "Top" | "Latest",
      sourcePostIds: chosen.map(x => x.post.id),
    });
  }

  const sorted = [...sources].sort((a, b) =>
    (a.post.engagement_rate ?? 0) - (b.post.engagement_rate ?? 0));
  const quartile = Math.max(1, Math.ceil(sorted.length / 4));
  const blindObservations = sources.filter(x => x.receipt.discovery_origin === "blind_discovery").length;
  const blindClusters = clusters.filter(x => x.origin === "blind_discovery").length;
  const targetKeywordObservations = sources.filter(x =>
    x.receipt.discovery_origin === "account_keyword" &&
    (!targetAccountId || x.receipt.target_account_id === targetAccountId)).length;
  const metrics: EvidenceSelection["metrics"] = {
    observations: sources.length,
    authors: new Set(sources.map(x => x.post.author_handle.toLowerCase())).size,
    clusters: clusters.length,
    blindObservations,
    blindClusters,
    targetKeywordObservations,
    top: sources.filter(x => x.receipt.discovery_mode === "Top").length,
    latest: sources.filter(x => x.receipt.discovery_mode === "Latest").length,
    lowReactionIds: sorted.slice(0, quartile).map(x => x.post.id),
    highReactionIds: sorted.slice(-quartile).map(x => x.post.id),
  };
  const reasons = [
    // Blind research is useful for transferable mechanisms, but it is not
    // evidence that a specific persona's subject was actually observed.
    Boolean(targetAccountId) && (options.requireAccountKeywordEvidence ?? true) && targetKeywordObservations === 0 &&
      "no verified account-specific keyword sources; blind-only research cannot ground account topics",
    sources.length < 6 && "fewer than six verified posts",
    metrics.authors < 4 && "fewer than four authors",
    clusters.length < 3 && "fewer than three independent search clusters",
    metrics.top === 0 && "no verified Top source",
    metrics.latest === 0 && "no verified Latest source",
    blindObservations < Math.ceil(sources.length * 0.3) && "independent post share under 30%",
    blindClusters < Math.ceil(clusters.length * 0.3) && "independent search cluster share under 30%",
  ].filter(Boolean);
  return { sources, clusters, metrics, ...(reasons.length ? { reason: reasons.join("; ") } : {}) };
}
