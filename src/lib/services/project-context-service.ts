import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { ProjectContextDoc } from "@/lib/types";

export const DEFAULT_AFFILIATE_CONTEXT_KEY = "affiliate_product_discovery_v1";
export const AFFILIATE_DISTRIBUTION_CONTEXT_KEY = "affiliate_distribution_v1";
const contexts = () => adminDb.collection("operator_contexts");

function numericRevision(value: unknown, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function getLegacyGuidanceContext(key: string): Promise<ProjectContextDoc | null> {
  const snapshot = await adminDb.collection("tips").where("protocol_key", "==", key).limit(1).get();
  const doc = snapshot.docs[0];
  if (!doc) return null;
  const data = doc.data();

  return {
    id: key,
    key,
    kind: "operating_protocol",
    title: String(data.title ?? key),
    content: String(data.text ?? ""),
    status: data.status === "inactive" ? "inactive" : "active",
    revision: numericRevision(data.revision ?? data.version, 1),
    version: (typeof data.version === "number" || typeof data.version === "string") ? data.version : 1,
    metadata: {
      legacy_scope: data.scope ?? "global",
      ...(data.drive_context_path ? { drive_context_path: data.drive_context_path } : {}),
      ...(data.updated_by ? { updated_by: data.updated_by } : {}),
    },
    source_guidance_id: doc.id,
    created_at: String(data.created_at ?? DateTime.utc().toISO()),
    updated_at: String(data.updated_at ?? data.created_at ?? DateTime.utc().toISO()),
  };
}

export async function getProjectContext(key = DEFAULT_AFFILIATE_CONTEXT_KEY) {
  const ref = contexts().doc(key);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() ?? {};
    const context = {
      id: snap.id,
      ...data,
      key,
      revision: numericRevision(data.revision, 1),
      version: (typeof data.version === "number" || typeof data.version === "string") ? data.version : 1,
    } as ProjectContextDoc;
    return { context, source: "operator_contexts" as const, legacyFallback: false };
  }

  const legacy = await getLegacyGuidanceContext(key);
  if (!legacy) return { context: null, source: "not_found" as const, legacyFallback: false };
  return {
    context: legacy,
    source: "legacy_guidance_fallback" as const,
    legacyFallback: true,
  };
}

export async function updateProjectContext(
  key: string,
  expectedRevision: number,
  changes: Record<string, unknown>,
): Promise<ProjectContextDoc> {
  const legacy = await getLegacyGuidanceContext(key);
  const ref = contexts().doc(key);

  return adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists
      ? ({ id: snap.id, ...snap.data() } as ProjectContextDoc)
      : legacy;

    const currentRevision = existing ? numericRevision(existing.revision, 1) : 0;
    if (currentRevision !== expectedRevision) {
      throw new Error(`revision conflict: expected ${expectedRevision}, current ${currentRevision}. Refresh and retry.`);
    }

    const now = DateTime.utc().toISO();
    const next: ProjectContextDoc = {
      ...(existing ?? {
        id: key,
        key,
        kind: "operating_protocol" as const,
        title: key,
        content: "",
        status: "active" as const,
        revision: 0,
        version: 1,
        created_at: now,
        updated_at: now,
      }),
      ...changes,
      id: key,
      key,
      kind: "operating_protocol",
      revision: currentRevision + 1,
      version: (typeof changes.version === "number" || typeof changes.version === "string")
        ? changes.version
        : existing?.version ?? 1,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    } as ProjectContextDoc;

    if (!next.content || typeof next.content !== "string") {
      throw new Error("Project context content must be a non-empty string.");
    }
    if (next.status !== "active" && next.status !== "inactive") {
      throw new Error("Project context status must be active or inactive.");
    }

    transaction.set(ref, next);
    return next;
  });
}

export async function getAffiliateDistributionRuntimeState() {
  const result = await getProjectContext(AFFILIATE_DISTRIBUTION_CONTEXT_KEY);
  const context = result.context;
  const offerRepliesEnabled = Boolean(
    context?.status === "active" &&
    context.metadata?.offerRepliesEnabled === true,
  );

  return {
    offerRepliesEnabled,
    blockReason: offerRepliesEnabled ? null : "affiliate_offer_global_disabled",
    contextRevision: context?.revision ?? null,
    contextVersion: context?.version ?? null,
    source: result.source,
  };
}
