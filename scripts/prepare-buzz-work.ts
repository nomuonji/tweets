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
  const current = accounts
    .filter(x => x.platform === "threads" && isPublishingEnabled(x))
    .map(account => {
      const version = getCharacterVersion(account);
      const available = (inventory.get(account.id) ?? [])
        .filter(draft => belongsToCharacterVersion(draft, version)).length;
      return { account, version, needed: Math.max(0, 5 - available) };
    })
    .filter(x => x.needed > 0)
    .sort((a, b) => String(a.account.lastPostExecutedAt ?? "").localeCompare(String(b.account.lastPostExecutedAt ?? "")));

  const result = { eligibleAccounts: current.length, prepared: 0, preserved: 0, skipped: 0, blocked: 0, ...research.guard };
  for (const [index, item] of Array.from(current.entries())) {
    const { account, version, needed } = item;
    const ref = adminDb.collection(COLLECTION).doc(account.id);
    // Read only a bounded window; account-auth credentials are NEVER copied
    // into these work items or printed in logs.
    const postsSnapshot = await adminDb.collection("posts")
      .where("account_id", "==", account.id).limit(25).get();
    const recentPosts = postsSnapshot.docs
      .map(doc => ({
        text: String(doc.get("text") ?? "").slice(0, 500),
        createdAt: String(doc.get("created_at") ?? ""),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12);
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
      if (["concepts_ready", "copy_ready", "staged", "processing"].includes(String(existing.status)) &&
          existing.characterVersion === version) {
        return "preserved" as const;
      }
      if (existing.fingerprint === fingerprint && existing.status === status) {
        return "skipped" as const;
      }
      tx.set(ref, {
        accountId: account.id,
        characterVersion: version,
        fingerprint,
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
