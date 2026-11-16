/**
 * Materialize compact, restartable, source-verified work for the ChatGPT
 * scheduled writer. NO drafts, posts, publishing, approval, or generated copy.
 *
 * Read costs: one observations scan, one batched lookup per referenced source,
 * one current draft inventory and a bounded recent-post sample per target.
 * Existing authored work is preserved instead of reset by a cron retry.
 */
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getAccounts, getOpenDraftInventory } from "@/lib/services/firestore.server";
import { isPublishingEnabled } from "@/lib/account-gates";
import { getCharacterVersion, belongsToCharacterVersion } from "@/lib/character-version";
import { selectResearchEvidence, verifyEvidenceSources } from "@/lib/buzz-replenishment-evidence";
import type { ExternalPostDoc, ExternalPostObservationDoc } from "@/lib/types";

const COLLECTION = "buzz_replenishment_work";
const CHUNK = 80;

async function collectEvidence() {
  const receiptSnapshots = await adminDb.collection("external_post_observations").get();
  const receipts = receiptSnapshots.docs.map(x => x.data() as ExternalPostObservationDoc);
  const refs = Array.from(new Set(receipts.map(x => x.external_post_id).filter(Boolean)))
    .map(id => adminDb.collection("external_posts").doc(id));
  const posts = new Map<string, ExternalPostDoc>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const snapshots = await adminDb.getAll(...refs.slice(i, i + CHUNK));
    for (const s of snapshots) {
      if (s.exists) posts.set(s.id, { id: s.id, ...s.data() } as ExternalPostDoc);
    }
  }
  return { ...verifyEvidenceSources(receipts, posts), receiptsRead: receipts.length, sourcesRead: posts.size };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const startedAt = DateTime.utc().toISO()!;
  const [source, accounts, inventory] = await Promise.all([
    collectEvidence(), getAccounts(), getOpenDraftInventory(),
  ]);
  const sample = selectResearchEvidence(source.verified);
  const research = {
    clusters: sample.clusters,
    // Exact immutable receipts + corresponding public original post; the
    // scheduled writer can cite sourcePostIds but must not invent sources.
    sources: sample.sources.map(x => ({
      post: {
        id: x.post.id, platform: x.post.platform, platform_post_id: x.post.platform_post_id,
        text: x.post.text, url: x.post.url, author_handle: x.post.author_handle,
        author_followers: x.post.author_followers ?? null,
        created_at: x.post.created_at, fetched_at: x.post.fetched_at,
        engagement_rate: x.post.engagement_rate, metrics: x.post.metrics,
        search_keyword: x.post.search_keyword ?? null,
        discovery_query_id: x.post.discovery_query_id ?? null,
        discovery_origin: x.post.discovery_origin ?? null,
        discovery_mode: x.post.discovery_mode ?? null,
      },
      receipt: x.receipt,
    })),
    metrics: sample.metrics,
    guard: {
      passed: !sample.reason,
      reason: sample.reason ?? null,
      observationsRead: source.receiptsRead,
      distinctSourcePostsRead: source.sourcesRead,
      verifiedSources: source.verified.length,
      rejected: source.rejected,
      verifiedAt: startedAt,
    },
  };
  const sourceDigest = digest(sample.sources.map(x => [x.post.id, x.receipt.id, x.receipt.text_hash]).sort());
  const eligible = accounts
    .filter(x => x.platform === "threads" && isPublishingEnabled(x))
    .map(account => {
      const version = getCharacterVersion(account);
      const available = (inventory.get(account.id) ?? [])
        .filter(draft => belongsToCharacterVersion(draft, version)).length;
      return { account, version, needed: Math.max(0, 5 - available) };
    })
    .filter(x => x.needed > 0);

  const current = await Promise.all(eligible.map(async item => {
    // A bare .limit() without ordering picks *arbitrary* Firestore documents;
    // that previously ranked July posts ahead of the account's November posts.
    // Prefer the indexed newest-first query, falling back to a COMPLETE account
    // scan (never a bounded, unordered sample) only when index is missing.
    const query = adminDb.collection("posts").where("account_id", "==", item.account.id);
    let snapshots;
    try {
      snapshots = await query.orderBy("created_at", "desc").limit(12).get();
    } catch (error) {
      if (!String((error as Error).message ?? error).includes("requires an index")) throw error;
      snapshots = await query.get();
    }
    const recentPosts = snapshots.docs
      .map(doc => ({
        text: String(doc.get("text") ?? "").slice(0, 500),
        createdAt: String(doc.get("created_at") ?? ""),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12);
    return { ...item, recentPosts };
  }));
  current.sort((a, b) =>
    String(a.recentPosts[0]?.createdAt ?? "").localeCompare(String(b.recentPosts[0]?.createdAt ?? "")) ||
    a.account.id.localeCompare(b.account.id));

  const result = { eligibleAccounts: current.length, prepared: 0, preserved: 0, skipped: 0, blocked: 0, ...research.guard };
  for (const [index, item] of Array.from(current.entries())) {
    const { account, version, needed, recentPosts } = item;
    const ref = adminDb.collection(COLLECTION).doc(account.id);
    const safeAccount = {
      accountId: account.id, handle: account.handle, platform: "threads" as const,
      characterVersion: version, neededDraftCount: needed,
      concept: account.concept ?? "", capturedAt: startedAt,
      minPostLength: account.minPostLength ?? null,
      maxPostLength: account.maxPostLength ?? null,
      lastPostExecutedAt: account.lastPostExecutedAt ?? null,
    };
    const fingerprint = digest([sourceDigest, safeAccount.accountId, version, needed, safeAccount.concept]);
    const status = sample.reason ? "blocked_evidence" : "research_ready";
    const action = await adminDb.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const existing = snapshot.data() ?? {};
      // Preserve user-authored intermediate research across routine wake-ups;
      // refresh an abandoned draft after 7 days so a stale corpus cannot
      // remain in the queue indefinitely. Staged packets are handled by Relay.
      const authored = ["research_in_progress", "concepts_ready", "copy_ready"].includes(String(existing.status));
      const ageMs = Date.now() - Date.parse(String(existing.preparedAt ?? ""));
      if (existing.characterVersion === version &&
          ((authored && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 7 * 86_400_000) ||
           ["staged", "processing"].includes(String(existing.status)))) {
        return "preserved" as const;
      }
      if (existing.fingerprint === fingerprint && existing.status === status &&
          existing.preflightVersion === 2 && existing.priority === index &&
          existing.recentPosts?.[0]?.createdAt === recentPosts[0]?.createdAt) {
        return "skipped" as const;
      }
      tx.set(ref, {
        accountId: account.id,
        characterVersion: version,
        fingerprint,
        preflightVersion: 2,
        status,
        priority: index,
        account: safeAccount,
        research,
        recentPosts,
        progress: {
          stage: status,
          nextStep: sample.reason
            ? "Collect more real independent evidence; do not draft."
            : "Extract 3 response mechanisms and 15 distinct ideas, then persist concepts_ready with the original work fingerprint.",
          candidateCount: 0,
          draftCount: 0,
        },
        preparedAt: startedAt,
        updatedAt: startedAt,
        ...(!snapshot.exists ? { createdAt: startedAt } : {}),
      });
      return status === "blocked_evidence" ? "blocked" as const : "prepared" as const;
    });
    result[action] += 1;
  }
  console.log("[Buzz Prep] " + JSON.stringify(result));
  // Missing evidence is a tracked state, not an excuse to bypass the Harness.
  if (sample.reason) process.exitCode = 1;
}
main().catch(error => {
  console.error("[Buzz Prep] Failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
