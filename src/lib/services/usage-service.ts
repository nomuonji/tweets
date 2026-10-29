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


