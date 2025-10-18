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
