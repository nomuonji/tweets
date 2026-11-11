import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";

const COLLECTION = "usage_stats";

export async function incrementApiUsage(apiName: string) {
  const docRef = adminDb.collection(COLLECTION).doc(apiName);
  const now = DateTime.utc();
  const month = now.toFormat("yyyy-MM");

  await adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(docRef);
    if (!snapshot.exists) {
      tx.set(docRef, {
        month,
        count: 1,
        updated_at: now.toISO(),
      });
      return;
    }

    const data = snapshot.data() as { month?: string; count?: number } | undefined;
    if (!data || data.month !== month) {
      tx.set(
        docRef,
        {
          month,
          count: 1,
          updated_at: now.toISO(),
        },
        { merge: true },
      );
      return;
    }

    tx.set(
      docRef,
      {
        month,
        count: (data.count ?? 0) + 1,
        updated_at: now.toISO(),
      },
      { merge: true },
    );
  });
}

export async function getMonthlyUsage(apiName: string) {
  const snapshot = await adminDb.collection(COLLECTION).doc(apiName).get();
  const now = DateTime.utc();
  const month = now.toFormat("yyyy-MM");

  if (!snapshot.exists) {
    return { month, count: 0 };
  }

  const data = snapshot.data() as { month?: string; count?: number } | undefined;
  if (!data || data.month !== month) {
    return { month, count: 0 };
  }

  return { month: data.month ?? month, count: data.count ?? 0 };
}

const BUDGET_COLLECTION = "settings";
const BUDGET_DOC = "api_budget";
const BUDGET_FIELD = "rapidapi_monthly_budget";

function normalizeBudget(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

/**
 * Budget lives in Firestore so the cron runtime and the MCP server agree on it.
 * The env var stays as a fallback for runtimes that cannot read the doc.
 */
async function resolveRapidApiBudget(): Promise<{
  budget: number | null;
  source: "firestore" | "env" | "none";
}> {
  try {
    const snapshot = await adminDb.collection(BUDGET_COLLECTION).doc(BUDGET_DOC).get();
    const data = snapshot.data() ?? {};
    if (snapshot.exists && BUDGET_FIELD in data) {
      return { budget: normalizeBudget(data[BUDGET_FIELD]), source: "firestore" };
    }
  } catch (error) {
    console.warn("[Usage] Could not read the stored API budget; falling back to env.", error);
  }
  const fromEnv = normalizeBudget(Number(process.env.RAPIDAPI_MONTHLY_BUDGET ?? ""));
  return { budget: fromEnv, source: fromEnv === null ? "none" : "env" };
}

/** Persist the monthly RapidAPI request budget. null means "no guard". */
export async function setRapidApiMonthlyBudget(
  value: number | null,
): Promise<{ budget: number | null }> {
  await adminDb
    .collection(BUDGET_COLLECTION)
    .doc(BUDGET_DOC)
    .set(
      {
        [BUDGET_FIELD]: normalizeBudget(value),
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
  return { budget: normalizeBudget(value) };
}


export class RapidApiBudgetExceededError extends Error {
  readonly budget: number;
  readonly used: number;
  readonly reserveRemaining: number;

  constructor(budget: number, used: number, reserveRemaining: number) {
    super(`RapidAPI monthly budget exhausted: ${used}/${budget} used; ${reserveRemaining} requests reserved.`);
    this.name = "RapidApiBudgetExceededError";
    this.budget = budget;
    this.used = used;
    this.reserveRemaining = reserveRemaining;
  }
}

/**
 * Atomically reserves one provider request before HTTP is sent.
 * Failed provider calls still consume a reservation because the provider may
 * have charged the request. Concurrent workers cannot spend the same slot.
 */
export async function reserveRapidApiRequest(
  reserveRemaining = 0,
): Promise<RapidApiBudgetState> {
  const remainingReserve = Math.max(0, Math.floor(reserveRemaining));
  const usageRef = adminDb.collection(COLLECTION).doc("rapidapi_twitter");
  const budgetRef = adminDb.collection(BUDGET_COLLECTION).doc(BUDGET_DOC);
  const now = DateTime.utc();
  const month = now.toFormat("yyyy-MM");
  let result: RapidApiBudgetState | null = null;

  await adminDb.runTransaction(async (tx) => {
    const usageSnapshot = await tx.get(usageRef);
    const budgetSnapshot = await tx.get(budgetRef);
    const budgetData = budgetSnapshot.data() ?? {};
    const hasStoredBudget = budgetSnapshot.exists && BUDGET_FIELD in budgetData;
    const configured = hasStoredBudget
      ? normalizeBudget(budgetData[BUDGET_FIELD])
      : normalizeBudget(Number(process.env.RAPIDAPI_MONTHLY_BUDGET ?? ""));
    const budgetSource: RapidApiBudgetState["budgetSource"] =
      hasStoredBudget ? "firestore" : configured === null ? "none" : "env";

    if (configured === null) {
      throw new Error("RapidAPI requests are blocked because no positive monthly budget is configured.");
    }

    const usageData = usageSnapshot.data() as { month?: string; count?: number } | undefined;
    const used = usageData?.month === month ? Math.max(0, usageData.count ?? 0) : 0;
    if (used + 1 + remainingReserve > configured) {
      throw new RapidApiBudgetExceededError(configured, used, remainingReserve);
    }

    const nextCount = used + 1;
    tx.set(usageRef, {
      month,
      count: nextCount,
      updated_at: now.toISO(),
    }, { merge: true });

    result = {
      month,
      count: nextCount,
      budget: configured,
      budgetSource,
      remaining: Math.max(0, configured - nextCount),
      exhausted: nextCount >= configured,
    };
  });

  if (!result) throw new Error("RapidAPI request reservation did not return a budget state.");
  return result;
}

export type RapidApiBudgetState = {
  month: string;
  count: number;
  budget: number | null;
  budgetSource: "firestore" | "env" | "none";
  remaining: number | null;
  exhausted: boolean;
};

/**
 * Read-only view of this month's RapidAPI spend against the configured budget.
 * Counters are written by every request but were never surfaced before, so
 * spending was invisible.
 */
export async function getRapidApiBudgetState(): Promise<RapidApiBudgetState> {
  const [usage, resolved] = await Promise.all([
    getMonthlyUsage("rapidapi_twitter"),
    resolveRapidApiBudget(),
  ]);
  const { budget, source } = resolved;
  const remaining = budget === null ? null : Math.max(0, budget - usage.count);
  return {
    ...usage,
    budget,
    budgetSource: source,
    remaining,
    exhausted: remaining !== null && remaining <= 0,
  };
}


