import { createHash } from "crypto";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";

export async function runIdempotentOperation<T>(operation: string, key: string, work: () => Promise<T>) {
  if (!key || key.length > 128) throw new Error("idempotencyKey is required and must be <= 128 characters.");
  const id = createHash("sha256").update(`${operation}:${key}`).digest("hex");
  const ref = adminDb.collection("agent_operations").doc(id);
  const previous = await ref.get();
  if (previous.exists && previous.data()?.status === "completed") return previous.data()?.result as T;
  await ref.set({ operation, key_hash: createHash("sha256").update(key).digest("hex"), status: "started", started_at: DateTime.utc().toISO() }, { merge: true });
  try { const result = await work(); await ref.set({ status: "completed", completed_at: DateTime.utc().toISO(), result }, { merge: true }); return result; }
  catch (error) { await ref.set({ status: "failed", failed_at: DateTime.utc().toISO(), error: (error as Error).message.slice(0, 1000) }, { merge: true }); throw error; }
}
