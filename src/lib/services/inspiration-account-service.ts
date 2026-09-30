import { createHash } from "crypto";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type {
  InspirationAccountDoc,
  InspirationAccountStatus,
  InspirationPlatform,
  InspirationWatchPriority,
} from "@/lib/types";

type ListFilters = {
  platform?: InspirationPlatform;
  status?: InspirationAccountStatus;
  tag?: string;
  targetAccountId?: string;
  query?: string;
  limit?: number;
};

type SaveArgs = {
  id?: string;
  expectedUpdatedAt?: string;
  expectedRevision?: number;
  account: Partial<InspirationAccountDoc>;
};

const COLLECTION = "inspiration_accounts";

function nowIso() {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

function collection() {
  return adminDb.collection(COLLECTION);
}

function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, "");
}

function normalizeStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
}

function normalizePatch(
  input: Partial<InspirationAccountDoc>,
): Partial<InspirationAccountDoc> {
  const patch = { ...input };
  delete patch.id;
  delete patch.created_at;
  delete patch.updated_at;
  delete patch.revision;

  if (typeof patch.handle === "string") {
    patch.handle = normalizeHandle(patch.handle);
  }
  if (patch.tags !== undefined) patch.tags = normalizeStrings(patch.tags);
  if (patch.themes !== undefined) patch.themes = normalizeStrings(patch.themes);
  if (patch.target_account_ids !== undefined) {
    patch.target_account_ids = normalizeStrings(patch.target_account_ids);
  }
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<InspirationAccountDoc>;
}

function deterministicId(platform: InspirationPlatform, handle: string) {
  const identity = `${platform}:${normalizeHandle(handle).toLowerCase()}`;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return `inspiration_${digest}`;
}

function mapDoc(
  doc: FirebaseFirestore.DocumentSnapshot,
): InspirationAccountDoc {
  return { id: doc.id, ...(doc.data() ?? {}) } as InspirationAccountDoc;
}

const priorityOrder: Record<InspirationWatchPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export async function listInspirationAccounts(
  filters: ListFilters = {},
): Promise<InspirationAccountDoc[]> {
  const snapshot = await collection().get();
  const query = filters.query?.trim().toLowerCase();
  const tag = filters.tag?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));

  return snapshot.docs
    .map(mapDoc)
    .filter((item) => !filters.platform || item.platform === filters.platform)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter(
      (item) =>
        !filters.targetAccountId ||
        (item.target_account_ids ?? []).includes(filters.targetAccountId),
    )
    .filter(
      (item) =>
        !tag ||
        (item.tags ?? []).some((value) => value.toLowerCase() === tag),
    )
    .filter((item) => {
      if (!query) return true;
      const haystack = [
        item.handle,
        item.display_name,
        item.profile_url,
        item.why_useful,
        item.notes,
        ...(item.tags ?? []),
        ...(item.themes ?? []),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "active") return -1;
        if (b.status === "active") return 1;
      }
      const priority =
        priorityOrder[a.watch_priority ?? "normal"] -
        priorityOrder[b.watch_priority ?? "normal"];
      if (priority !== 0) return priority;
      return String(b.updated_at).localeCompare(String(a.updated_at));
    })
    .slice(0, limit);
}

export async function getInspirationAccount(
  id: string,
): Promise<InspirationAccountDoc | null> {
  const snapshot = await collection().doc(id).get();
  return snapshot.exists ? mapDoc(snapshot) : null;
}

export async function saveInspirationAccount({
  id,
  expectedUpdatedAt,
  expectedRevision,
  account,
}: SaveArgs): Promise<InspirationAccountDoc> {
  const patch = normalizePatch(account);
  const explicitPlatform = patch.platform;
  const explicitHandle = patch.handle;
  const createId =
    !id && explicitPlatform && explicitHandle
      ? deterministicId(explicitPlatform, explicitHandle)
      : undefined;
  const ref = collection().doc(id ?? createId ?? collection().doc().id);

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? mapDoc(snapshot) : null;

    if (existing) {
      if (
        expectedUpdatedAt &&
        existing.updated_at !== expectedUpdatedAt
      ) {
        throw new Error("updated_at conflict: refresh and retry.");
      }
      if (
        expectedRevision !== undefined &&
        (existing.revision ?? 0) !== expectedRevision
      ) {
        throw new Error("revision conflict: refresh and retry.");
      }
    } else if (id && (expectedUpdatedAt || expectedRevision !== undefined)) {
      throw new Error("Inspiration account not found.");
    }

    const platform = patch.platform ?? existing?.platform;
    const handle = patch.handle ?? existing?.handle;
    if (!platform || !handle) {
      throw new Error("platform and handle are required.");
    }

    const now = nowIso();
    const next: Omit<InspirationAccountDoc, "id"> = {
      platform,
      handle: normalizeHandle(handle),
      display_name: patch.display_name ?? existing?.display_name ?? "",
      profile_url: patch.profile_url ?? existing?.profile_url ?? "",
      status: patch.status ?? existing?.status ?? "active",
      watch_priority:
        patch.watch_priority ?? existing?.watch_priority ?? "normal",
      why_useful: patch.why_useful ?? existing?.why_useful ?? "",
      tags: patch.tags ?? existing?.tags ?? [],
      themes: patch.themes ?? existing?.themes ?? [],
      target_account_ids:
        patch.target_account_ids ?? existing?.target_account_ids ?? [],
      notes: patch.notes ?? existing?.notes ?? "",
      source: patch.source ?? existing?.source ?? "manual",
      last_reviewed_at:
        patch.last_reviewed_at ?? existing?.last_reviewed_at,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      revision: (existing?.revision ?? 0) + 1,
    };

    transaction.set(ref, next, { merge: false });
  });

  const saved = await ref.get();
  return mapDoc(saved);
}

export async function archiveInspirationAccount(
  id: string,
  expectedUpdatedAt: string,
  reason?: string,
): Promise<InspirationAccountDoc> {
  const current = await getInspirationAccount(id);
  if (!current) throw new Error("Inspiration account not found.");
  return saveInspirationAccount({
    id,
    expectedUpdatedAt,
    expectedRevision: current.revision,
    account: {
      status: "archived",
      notes: reason
        ? [current.notes, `Archived: ${reason}`].filter(Boolean).join("\n")
        : current.notes,
    },
  });
}

export async function getInspirationResearchWork(limit = 20) {
  const items = await listInspirationAccounts({
    status: "active",
    limit: Math.max(limit * 4, 50),
  });
  const now = DateTime.utc();

  const ranked = items
    .map((item) => {
      const reviewed = item.last_reviewed_at
        ? DateTime.fromISO(item.last_reviewed_at)
        : null;
      const ageDays =
        reviewed?.isValid === true
          ? Math.max(0, now.diff(reviewed, "days").days)
          : null;
      return {
        ...item,
        review_age_days: ageDays,
        review_state: reviewed?.isValid ? "reviewed_before" : "never_reviewed",
      };
    })
    .sort((a, b) => {
      const priority =
        priorityOrder[a.watch_priority ?? "normal"] -
        priorityOrder[b.watch_priority ?? "normal"];
      if (priority !== 0) return priority;
      if (a.last_reviewed_at == null && b.last_reviewed_at != null) return -1;
      if (a.last_reviewed_at != null && b.last_reviewed_at == null) return 1;
      return String(a.last_reviewed_at ?? "").localeCompare(
        String(b.last_reviewed_at ?? ""),
      );
    })
    .slice(0, Math.max(1, Math.min(limit, 100)));

  return {
    items: ranked,
    summary: {
      active_accounts: items.length,
      returned: ranked.length,
      never_reviewed: ranked.filter((item) => item.last_reviewed_at == null)
        .length,
    },
  };
}
