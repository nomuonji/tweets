import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getAccounts } from "@/lib/services/firestore.server";
import { isDiscoveryEnabled } from "@/lib/account-gates";
import { syncExternalDiscovery } from "@/lib/services/external-discovery-service";
import { getRapidApiBudgetState } from "@/lib/services/usage-service";
import { runBlindExternalDiscovery } from "@/lib/services/blind-discovery-service";

const PIPELINE_LEASE_MINUTES = 45;

async function main() {
  const now = DateTime.utc();
  const jstDate = now.setZone("Asia/Tokyo").toISODate()!;
  const runId = `discovery_${jstDate.replace(/-/g, "")}`;
  const stateRef = adminDb.collection("external_discovery_state").doc("pipeline-global");
  const runRef = adminDb.collection("external_discovery_runs").doc(runId);
  const leaseUntil = now.plus({ minutes: PIPELINE_LEASE_MINUTES }).toISO()!;

  const claim = await adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(stateRef);
    const state = snapshot.data() ?? {};
    if (state.last_completed_jst_date === jstDate) return "completed" as const;
    const activeUntil = typeof state.lease_until === "string"
      ? DateTime.fromISO(state.lease_until).toMillis()
      : 0;
    if (
      typeof state.lease_run_id === "string" &&
      state.lease_run_id.length > 0 &&
      Number.isFinite(activeUntil) &&
      activeUntil > now.toMillis()
    ) return "locked" as const;

    tx.set(stateRef, {
      lease_run_id: runId,
      lease_until: leaseUntil,
      updated_at: now.toISO(),
    }, { merge: true });
    return "claimed" as const;
  });

  if (claim === "completed") {
    console.log(`[Discovery] ${jstDate} already completed; no duplicate run.`);
    return;
  }
  if (claim === "locked") {
    throw new Error("Another unified discovery run currently owns the pipeline lease.");
  }

  const startedAt = DateTime.utc().toISO()!;
  await runRef.set({
    run_id: runId,
    status: "running",
    pipeline_version: "unified-discovery-v1",
    jst_date: jstDate,
    started_at: startedAt,
    sources: ["account_keyword", "reference_account", "blind_discovery"],
    updated_at: startedAt,
  }, { merge: true });

  const accountResults: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let blindResult: unknown = null;

  try {
    const accounts = await getAccounts();
    for (const account of accounts) {
      if (!isDiscoveryEnabled(account)) continue;
      if (
        (account.discoveryKeywords?.length ?? 0) === 0 &&
        (account.referenceAccountIds?.length ?? 0) === 0
      ) continue;

      try {
        const result = await syncExternalDiscovery(account, { runId });
        accountResults.push({
          accountId: account.id,
          handle: account.handle,
          synced: result.synced.length,
          cached: result.cached,
          stoppedByBudget: result.stoppedByBudget,
        });
        console.log(
          `[Discovery] ${account.handle}: ${result.synced.join(", ") || "cache fresh"}; ` +
          `budget ${result.budget.count}/${result.budget.budget ?? "unset"}`,
        );
        if (result.stoppedByBudget) {
          console.log("[Discovery] Account acquisition paused to preserve two Blind Discovery requests.");
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${account.handle}: ${message}`);
        console.error(`[Discovery] Account source failed for ${account.handle}:`, error);
      }
    }

    // Always attempt the independent lane after account-scoped work. Each
    // account request reserved two slots, and this collector independently
    // requires both Top and Latest budget slots before it starts.
    try {
      blindResult = await runBlindExternalDiscovery();
      console.log("[Discovery] Blind lane:", JSON.stringify(blindResult));
      const blindStatus = (blindResult as { status?: string; reason?: string } | null)?.status;
      const blindReason = (blindResult as { status?: string; reason?: string } | null)?.reason ?? "";
      if (blindStatus === "skipped" && /budget/i.test(blindReason)) {
        errors.push(`blind_discovery_budget: ${blindReason}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`blind_discovery: ${message}`);
      console.error("[Discovery] Blind lane failed:", error);
    }

    const budget = await getRapidApiBudgetState();
    const completedAt = DateTime.utc().toISO()!;
    const status = errors.length > 0 ? "partial" : "completed";
    await runRef.set({
      status,
      account_results: accountResults,
      account_count: accountResults.length,
      blind_result: blindResult,
      errors,
      budget,
      completed_at: completedAt,
      updated_at: completedAt,
    }, { merge: true });

    await adminDb.runTransaction(async (tx) => {
      const snapshot = await tx.get(stateRef);
      if (snapshot.get("lease_run_id") !== runId) {
        throw new Error("Unified discovery lease changed before completion.");
      }
      tx.set(stateRef, {
        ...(errors.length === 0 ? {
          last_completed_jst_date: jstDate,
          last_completed_run_id: runId,
        } : {}),
        lease_run_id: null,
        lease_until: null,
        updated_at: completedAt,
      }, { merge: true });
    });

    if (errors.length > 0) {
      throw new Error(`Unified discovery completed with ${errors.length} source error(s): ${errors.join(" | ")}`);
    }
  } catch (error) {
    const failedAt = DateTime.utc().toISO()!;
    await runRef.set({
      status: "failed",
      errors,
      failure: error instanceof Error ? error.message.slice(0, 1500) : String(error).slice(0, 1500),
      completed_at: failedAt,
      updated_at: failedAt,
    }, { merge: true });
    await adminDb.runTransaction(async (tx) => {
      const snapshot = await tx.get(stateRef);
      if (snapshot.get("lease_run_id") === runId) {
        tx.set(stateRef, {
          lease_run_id: null,
          lease_until: null,
          updated_at: failedAt,
        }, { merge: true });
      }
    });
    throw error;
  }
}

main().catch((error) => {
  console.error("[Discovery] Unified pipeline failed:", error);
  process.exit(1);
});
