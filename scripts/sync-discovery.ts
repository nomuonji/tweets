import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getAccounts } from "@/lib/services/firestore.server";
import { isDiscoveryEnabled } from "@/lib/account-gates";
import { syncExternalDiscovery } from "@/lib/services/external-discovery-service";
import { getRapidApiBudgetState } from "@/lib/services/usage-service";
import { runBlindExternalDiscovery } from "@/lib/services/blind-discovery-service";

const PIPELINE_LEASE_MINUTES = 45;

// A provider 429 is a shared outage/quota signal, not an account-level
// editorial failure. Stop the current collection pass rather than repeating
// the same paid failing request for every account.
function isProvider429(error: unknown): boolean {
  const e = error as { response?: { status?: number }; status?: number; message?: string };
  return e?.response?.status === 429 || e?.status === 429 ||
    /\b429\b/.test(String(e?.message ?? error));
}

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
    if (state.last_completed_jst_date === jstDate || state.last_attempted_jst_date === jstDate) return "completed" as const;
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
  const blindResults: unknown[] = [];
  let consecutiveEmptyBlindRuns = 0;
  let providerRateLimited = false;

  try {
    // Independent sources first: account-specific searches must never exhaust
    // the shared RapidAPI allowance before the Blind Discovery evidence lane.
    const configuredTarget = Number(process.env.BLIND_DAILY_SEED_TARGET ?? "1");
    const dailyTarget = Number.isInteger(configuredTarget)
      ? Math.max(1, Math.min(6, configuredTarget))
      : 1;
    for (let i = 0; i < dailyTarget; i += 1) {
      try {
        const result = await runBlindExternalDiscovery();
        blindResults.push(result);
        console.log(`[Discovery] Blind lane ${i + 1}/${dailyTarget}:`, JSON.stringify(result));
        if (result.status === "completed") {
          consecutiveEmptyBlindRuns = 0;
          continue;
        }
        if (result.status === "empty") {
          consecutiveEmptyBlindRuns++;
          if (consecutiveEmptyBlindRuns >= 2) {
            errors.push("blind_discovery: two consecutive zero-source searches; stopped to preserve RapidAPI budget. Check search.php parsing and query results.");
            break;
          }
          continue;
        }
        if (result.status === "locked" || /budget/i.test(result.reason ?? "")) {
          errors.push(`blind_discovery: ${result.reason ?? result.status}`);
        }
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`blind_discovery: ${message}`);
        providerRateLimited = isProvider429(error);
        console.error("[Discovery] Independent acquisition failed:", message,
          providerRateLimited ? "(shared provider 429; skipping account calls)" : "");
        break;
      }
    }

    const accounts = (await getAccounts()).filter(account =>
      isDiscoveryEnabled(account) &&
      ((account.discoveryKeywords?.length ?? 0) > 0 || (account.referenceAccountIds?.length ?? 0) > 0));
    // Keep the exact existing per-account request cap and shared budget; spend
    // scarce requests on accounts with no verified topic evidence first.
    const workDocs = accounts.length ? await adminDb.getAll(
      ...accounts.map(account => adminDb.collection("buzz_replenishment_work").doc(account.id))) : [];
    const topicCounts = new Map(workDocs.map((doc, index) => [
      accounts[index].id, Number(doc.get("research.guard.targetKeywordSources") ?? 0),
    ]));
    accounts.sort((a, b) =>
      (topicCounts.get(a.id) ?? 0) - (topicCounts.get(b.id) ?? 0) ||
      a.id.localeCompare(b.id));
    for (const account of (providerRateLimited ? [] : accounts)) {

      try {
        const result = await syncExternalDiscovery(account, { runId });
        accountResults.push({
          accountId: account.id,
          handle: account.handle,
          synced: result.synced.length,
          emptySources: result.emptySources,
          cached: result.cached,
          stoppedByBudget: result.stoppedByBudget,
        });
        console.log(
          `[Discovery] ${account.handle}: ${result.synced.join(", ") || "no new source"}; empty=${result.emptySources.length}, cached=${result.cached}; ` +
          `budget ${result.budget.count}/${result.budget.budget ?? "unset"}`,
        );
        if (result.emptySources.length > 0) {
          errors.push(`${account.handle}: source query returned zero usable posts (${result.emptySources.join(", ")})`);
        }
        if (result.stoppedByBudget) {
          console.log("[Discovery] Account acquisition paused to preserve two Blind Discovery requests.");
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${account.handle}: ${message}`);
        providerRateLimited = isProvider429(error);
        console.error(`[Discovery] Account source failed for ${account.handle}:`, message);
        if (providerRateLimited) {
          console.error("[Discovery] Provider 429; stop remaining account requests for this run.");
          break;
        }
      }
    }

    const budget = await getRapidApiBudgetState();
    const completedAt = DateTime.utc().toISO()!;
    const status = errors.length > 0 ? "partial" : "completed";
    await runRef.set({
      status,
      account_results: accountResults,
      account_count: accountResults.length,
      blind_result: blindResults,
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
        last_attempted_jst_date: jstDate,
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
          last_attempted_jst_date: jstDate,
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
