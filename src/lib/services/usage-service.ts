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

/**
 * Monthly request budget for RapidAPI Twitter. Unset or 0 disables the guard,
 * which keeps behaviour unchanged until a plan limit is recorded.
 */
export function rapidApiMonthlyBudget(): number | null {
  const parsed = Number(process.env.RAPIDAPI_MONTHLY_BUDGET ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export type RapidApiBudgetState = {
  month: string;
  count: number;
  budget: number | null;
  remaining: number | null;
  exhausted: boolean;
};

/**
 * Read-only view of this month's RapidAPI spend against the configured budget.
 * Counters are written by every request but were never surfaced before, so
 * spending was invisible.
 */
export async function getRapidApiBudgetState(): Promise<RapidApiBudgetState> {
  const usage = await getMonthlyUsage("rapidapi_twitter");
  const budget = rapidApiMonthlyBudget();
  const remaining = budget === null ? null : Math.max(0, budget - usage.count);
  return {
    ...usage,
    budget,
    remaining,
    exhausted: remaining !== null && remaining <= 0,
  };
}

