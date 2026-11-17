/**
 * Vercel-independent consumer of Agent HQ's reviewed *candidate packets*.
 *
 * Never trusts Firestore's staging status as editorial approval. All draft
 * writes must pass the same live Buzz Harness and server-side Gemini blind
 * review used by the Operator MCP. Do not use this script to author posts.
 */
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { BuzzHarnessPacketSchema, buzzPacketHash } from "@/lib/buzz-harness";
import { isGeminiTransportFailure } from "@/lib/gemini/client";
import { getBuzzHarnessRun, submitBuzzHarnessRun, approveBuzzHarnessRun } from "@/lib/services/buzz-harness-service";
import { createAgentDrafts } from "@/lib/services/draft-service";

const COLLECTION = "buzz_fallback_packets";
const LEASE_MINUTES = 45;
const MAX_PACKETS_PER_RUN = 3;

type Claimed = { id: string; packet: unknown };

async function claim(id: string): Promise<Claimed | null> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  return adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    const lockUntil = Date.parse(String(data.lease_until ?? ""));
    if (data.status === "processing" && Number.isFinite(lockUntil) && lockUntil > Date.now()) return null;
    const retry = data.status === "needs_attention" &&
      isGeminiTransportFailure(data.last_error) &&
      Number(data.attempt_count ?? 0) < 2;
    if (data.status !== "ready_for_harness" && data.status !== "processing" && !retry) return null;
    // A packet must be explicitly staged by the scheduled Agent HQ worker.
    if (data.staged_by !== "chatgpt-routine-worker") return null;
    tx.update(ref, {
      status: "processing",
      ...(retry ? { previous_transport_error: data.last_error } : {}),
      lease_until: DateTime.utc().plus({ minutes: LEASE_MINUTES }).toISO(),
      last_attempt_at: DateTime.utc().toISO(),
      attempt_count: Number(data.attempt_count ?? 0) + 1,
    });
    return { id, packet: data.buzzHarnessPacket };
  });
}

async function processPacket(item: Claimed): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(item.id);
  const parsed = BuzzHarnessPacketSchema.safeParse(item.packet);
  if (!parsed.success) {
    await ref.update({
      status: "invalid_packet",
      lease_until: null,
      last_error: "Missing or invalid complete BuzzHarnessPacket: " + parsed.error.issues.slice(0, 3).map(x => x.path.join(".")).join(", "),
      updated_at: DateTime.utc().toISO(),
    });
    throw new Error(`Staged packet ${item.id} failed strict schema validation; no draft write attempted.`);
  }
  const packet = parsed.data;
  if (packet.accounts.some(a => a.platform !== "threads")) {
    await ref.update({ status: "invalid_packet", lease_until: null, last_error: "Threads recovery accepts Threads account packets only." });
    throw new Error("Non-Threads account in recovery packet; refusing to save.");
  }
  const packetAge = Date.now() - Date.parse(packet.createdAt);
  if (!Number.isFinite(packetAge) || packetAge < 0 || packetAge > 24 * 60 * 60 * 1000) {
    await ref.update({ status: "invalid_packet", lease_until: null, last_error: "Evidence packet is older than 24h or dated in the future." });
    throw new Error("Staged packet is stale; no draft write attempted.");
  }

  try {
    // Submit/review/consume are recoverable across cancelled Actions. The
    // Harness' per-account consumption occurs in the draft-save transaction.
    let run = await getBuzzHarnessRun(packet.runId);
    if (!run.found) {
      const submitted = await submitBuzzHarnessRun(packet);
      if (submitted.status !== "awaiting_review" || !submitted.reportHash) {
        await ref.update({
          status: "harness_rejected", lease_until: null,
          last_error: submitted.errors.slice(0, 8).join(" | ").slice(0, 1400),
          updated_at: DateTime.utc().toISO(),
        });
        throw new Error(`Buzz Harness rejected packet ${item.id}; no draft write attempted.`);
      }
      run = await getBuzzHarnessRun(packet.runId);
    }

    if (!run.found || run.packetHash !== buzzPacketHash(packet)) {
      throw new Error("Existing Harness packet hash mismatch; no draft write attempted.");
    }
    const retry = run.status === "review_failed" && isGeminiTransportFailure(run.reviewFailure) &&
      run.transportReviewRetries < 1;
    if (run.status === "awaiting_review" || retry) {
      if (!run.reportHash) throw new Error("Harness has no reportHash.");
      const reviewed = await approveBuzzHarnessRun({
        runId: packet.runId,
        reportHash: run.reportHash,
        retryTransportFailure: retry,
        expectedPacketHash: buzzPacketHash(packet),
      });
      if (reviewed.status !== "approved" || !reviewed.approvalHash) {
        await ref.update({
          status: "review_rejected", lease_until: null,
          last_error: reviewed.errors.slice(0, 8).join(" | ").slice(0, 1400),
          updated_at: DateTime.utc().toISO(),
        });
        throw new Error("Independent blind review rejected copy; no draft write attempted.");
      }
      run = await getBuzzHarnessRun(packet.runId);
    }

    if (!["approved", "partially_consumed", "consumed"].includes(String(run.status)) || !run.approvalHash) {
      throw new Error(`Harness state ${run.status} has no valid independent Gemini approval; refusing drafts.`);
    }

    const savedAccounts: Array<{ accountId: string; count: number }> = [];
    for (const account of packet.accounts) {
      if (run.consumedAccountIds?.includes(account.accountId)) continue;
      const drafts = packet.drafts.filter(d => d.accountId === account.accountId);
      if (drafts.length === 0) throw new Error(`No reviewed drafts for ${account.accountId}`);
      const saved = await createAgentDrafts(account.accountId, account.characterVersion, drafts.map(d => ({
        text: d.text,
        hashtags: d.hashtags ?? [],
        ...(d.topicTag ? { topicTag: d.topicTag } : {}),
        createdBy: "agent",
        generatedBy: `agent-hq:${packet.model}`,
        provenance: {
          buzzRunId: packet.runId,
          candidateId: d.candidateId,
          externalPostIds: d.sourcePostIds,
          batchId: packet.runId,
        },
      })), { runId: packet.runId, approvalHash: run.approvalHash });
      savedAccounts.push({ accountId: account.accountId, count: saved.length });
      run = await getBuzzHarnessRun(packet.runId);
    }

    // Atomically complete the isolated packet and its corresponding
    // per-account authoring work. A later research preparation may then
    // replenish the *remaining* inventory gap (including partial 1-post runs).
    const completedAt = DateTime.utc().toISO()!;
    const workRefs = packet.accounts.map(account =>
      adminDb.collection("buzz_replenishment_work").doc(account.accountId));
    await adminDb.runTransaction(async tx => {
      const [packetSnapshot, ...workSnapshots] = await Promise.all([
        tx.get(ref), ...workRefs.map(workRef => tx.get(workRef)),
      ]);
      if (packetSnapshot.get("status") !== "processing") {
        throw new Error("Packet completion claim was lost; refuse to overwrite a newer status.");
      }
      tx.update(ref, {
        status: "completed",
        completed_at: completedAt,
        lease_until: null,
        approved_run_id: packet.runId,
        saved_accounts: savedAccounts,
        updated_at: completedAt,
      });
      workSnapshots.forEach((snapshot, index) => {
        if (snapshot.get("stagedRunId") !== packet.runId || snapshot.get("status") !== "staged") return;
        tx.update(workRefs[index], {
          status: "completed",
          completedAt,
          savedDraftCount: savedAccounts.find(x => x.accountId === packet.accounts[index].accountId)?.count ?? 0,
          updatedAt: completedAt,
        });
      });
    });
    console.log("[Buzz Relay] Approved and saved", JSON.stringify({ packetId: item.id, runId: packet.runId, savedAccounts }));
  } catch (error) {
    // Preserve failure history. Only bounded, unapproved transport failures
    // qualify for a new independent review; editorial rejection never does.
    const state = await ref.get();
    const reason = String(error instanceof Error ? error.message : error).slice(0, 1400);
    if (state.data()?.status === "processing") {
      await ref.update({
        status: "needs_attention",
        lease_until: null,
        last_error: reason,
        updated_at: DateTime.utc().toISO(),
      });
    }
    // Record the failed review in the research queue, never turn a rejected
    // packet into a draft or retry the same final copy without a new review.
    for (const account of packet.accounts) {
      // The work stays staged while the exact packet can be retried.
      if (isGeminiTransportFailure(reason) && Number(state.data()?.attempt_count ?? 0) < 2) continue;
      const workRef = adminDb.collection("buzz_replenishment_work").doc(account.accountId);
      await adminDb.runTransaction(async tx => {
        const work = await tx.get(workRef);
        if (work.get("status") !== "staged" || work.get("stagedRunId") !== packet.runId) return;
        tx.update(workRef, {
          status: "review_blocked",
          reviewError: reason,
          updatedAt: DateTime.utc().toISO(),
        });
      });
    }
    throw error;
  }
}

async function main() {
  const snapshot = await adminDb.collection(COLLECTION)
    .where("status", "in", ["ready_for_harness", "processing"])
    .limit(10)
    .get();
  const retrySnapshot = await adminDb.collection(COLLECTION)
    .where("status", "==", "needs_attention")
    .limit(30)
    .get();
  let processed = 0;
  let failed = 0;
  // Recover previously blocked packets before consuming newly staged work.
  for (const doc of [...retrySnapshot.docs.filter(doc =>
    isGeminiTransportFailure(doc.get("last_error")) && Number(doc.get("attempt_count") ?? 0) < 2
  ), ...snapshot.docs]) {
    if (processed >= MAX_PACKETS_PER_RUN) break;
    const item = await claim(doc.id);
    if (!item) continue;
    processed += 1;
    try {
      await processPacket(item);
    } catch (error) {
      failed += 1;
      console.error(`[Buzz Relay] Packet ${item.id} failed:`, error);
    }
  }
  console.log("[Buzz Relay] Result", JSON.stringify({ processed, failed }));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[Buzz Relay] Fatal error:", error);
  process.exitCode = 1;
});
