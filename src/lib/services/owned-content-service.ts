import { createHash } from "crypto";
import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { getAccount } from "@/lib/services/firestore.server";
import type { AccountDoc, Platform, PostDoc } from "@/lib/types";

export type OwnedContentSourceType = "website" | "note" | "newsletter" | "other";
export type OwnedContentSourceStatus = "active" | "paused" | "archived";
export type OwnedContentItemStatus = "candidate" | "active" | "paused" | "archived";

export interface OwnedContentSourceRecord {
  id: string;
  source_type: OwnedContentSourceType;
  provider: string;
  external_source_id?: string;
  name: string;
  base_url?: string;
  language?: string;
  themes?: string[];
  allowed_platforms?: Platform[];
  allowed_account_ids?: string[];
  persona_fits?: string[];
  distribution_hooks?: string[];
  weight?: number;
  status: OwnedContentSourceStatus;
  revision: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface OwnedContentItemRecord {
  id: string;
  source_id: string;
  external_content_id?: string;
  title: string;
  canonical_url: string;
  status: OwnedContentItemStatus;
  themes?: string[];
  allowed_account_ids?: string[];
  persona_fits?: string[];
  distribution_hooks?: string[];
  published_at?: string;
  notes?: string;
  revision: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

type SourceFilters = {
  sourceType?: OwnedContentSourceType;
  provider?: string;
  accountId?: string;
  status?: OwnedContentSourceStatus;
  limit?: number;
};

type ItemFilters = {
  sourceId?: string;
  accountId?: string;
  status?: OwnedContentItemStatus;
  limit?: number;
};

function sourceCollection() {
  return adminDb.collection("owned_content_sources");
}

function itemCollection() {
  return adminDb.collection("owned_content_items");
}

function nowIso() {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function normalizePatch(value: Record<string, unknown>) {
  const patch = { ...value };
  delete patch.id;
  delete patch.created_at;
  delete patch.updated_at;
  delete patch.revision;
  return stripUndefined(patch);
}

function mapSource(doc: FirebaseFirestore.DocumentSnapshot): OwnedContentSourceRecord {
  return { id: doc.id, ...(doc.data() ?? {}) } as OwnedContentSourceRecord;
}

function mapItem(doc: FirebaseFirestore.DocumentSnapshot): OwnedContentItemRecord {
  return { id: doc.id, ...(doc.data() ?? {}) } as OwnedContentItemRecord;
}

function normalizeTheme(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function accountThemes(account: AccountDoc): string[] {
  const raw = (account as AccountDoc & { monetizationThemes?: string[] }).monetizationThemes ?? [];
  return unique(raw.map(normalizeTheme));
}

function sourceThemes(source: OwnedContentSourceRecord): string[] {
  return unique((source.themes ?? []).map(normalizeTheme));
}

function itemThemes(item: OwnedContentItemRecord): string[] {
  return unique((item.themes ?? []).map(normalizeTheme));
}

function isAccountAllowed(
  account: AccountDoc,
  source: OwnedContentSourceRecord,
  item?: OwnedContentItemRecord,
) {
  if (source.status !== "active") return false;
  if (source.allowed_platforms?.length && !source.allowed_platforms.includes(account.platform)) return false;
  if (source.allowed_account_ids?.length && !source.allowed_account_ids.includes(account.id)) return false;
  if (item) {
    if (item.status !== "active") return false;
    if (item.allowed_account_ids?.length && !item.allowed_account_ids.includes(account.id)) return false;
  }
  return true;
}

export function scoreOwnedContent(
  account: AccountDoc,
  source: OwnedContentSourceRecord,
  item: OwnedContentItemRecord,
) {
  const reasons: string[] = [];
  const blockReasons: string[] = [];
  let score = 0;

  if (!isAccountAllowed(account, source, item)) blockReasons.push("account_or_source_not_allowed");

  if (source.allowed_account_ids?.includes(account.id)) {
    score += 50;
    reasons.push("source_explicit_account_allowlist");
  }
  if (item.allowed_account_ids?.includes(account.id)) {
    score += 25;
    reasons.push("item_explicit_account_allowlist");
  }

  const aThemes = accountThemes(account);
  const contentThemes = unique([...sourceThemes(source), ...itemThemes(item)]);
  const overlap = contentThemes.filter((theme) => aThemes.includes(theme));
  if (overlap.length) {
    score += Math.min(30, overlap.length * 10);
    reasons.push(`theme_overlap:${overlap.join(",")}`);
  }

  const personaFits = unique([...(source.persona_fits ?? []), ...(item.persona_fits ?? [])])
    .map((value) => value.trim().toLowerCase());
  const tokens = [account.id, account.handle, account.display_name]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  if (personaFits.some((fit) => tokens.some((token) => token.includes(fit) || fit.includes(token)))) {
    score += 10;
    reasons.push("persona_fit");
  }

  score = Math.round(score * Math.max(0.1, source.weight ?? 1));
  if (score <= 0) blockReasons.push("no_contextual_match");

  return {
    eligible: blockReasons.length === 0,
    score,
    reasons,
    blockReasons: unique(blockReasons),
    themeOverlap: overlap,
  };
}

export async function listOwnedContentSources(
  filters: SourceFilters = {},
): Promise<OwnedContentSourceRecord[]> {
  const snapshot = await sourceCollection().get();
  let items = snapshot.docs.map(mapSource).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (filters.sourceType) items = items.filter((item) => item.source_type === filters.sourceType);
  if (filters.provider) items = items.filter((item) => item.provider === filters.provider);
  if (filters.status) items = items.filter((item) => item.status === filters.status);
  if (filters.accountId) {
    items = items.filter((item) => !item.allowed_account_ids?.length || item.allowed_account_ids.includes(filters.accountId!));
  }
  return items.slice(0, filters.limit ?? 50);
}

export async function getOwnedContentSource(id: string) {
  const snapshot = await sourceCollection().doc(id).get();
  return snapshot.exists ? mapSource(snapshot) : null;
}

export async function saveOwnedContentSource(args: {
  id?: string;
  expectedUpdatedAt?: string;
  expectedRevision?: number;
  source: Record<string, unknown>;
}): Promise<OwnedContentSourceRecord> {
  const ref = args.id ? sourceCollection().doc(args.id) : sourceCollection().doc();
  const now = nowIso();

  await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    const patch = normalizePatch(args.source);
    if (!existing.exists) {
      for (const key of ["source_type", "provider", "name"]) {
        if (typeof patch[key] !== "string" || !String(patch[key]).trim()) {
          throw new Error(`${key} is required when creating an owned content source.`);
        }
      }
      transaction.set(ref, {
        ...patch,
        status: patch.status ?? "active",
        revision: 1,
        created_at: now,
        updated_at: now,
      });
      return;
    }

    const current = mapSource(existing);
    if (!args.expectedUpdatedAt) throw new Error("expectedUpdatedAt is required for owned content source updates.");
    if (current.updated_at !== args.expectedUpdatedAt) throw new Error("updated_at conflict: refresh and retry.");
    if (args.expectedRevision !== undefined && current.revision !== args.expectedRevision) {
      throw new Error("revision conflict: refresh and retry.");
    }
    transaction.update(ref, {
      ...patch,
      revision: current.revision + 1,
      updated_at: now,
    });
  });

  const saved = await ref.get();
  return mapSource(saved);
}

export async function listOwnedContentItems(
  filters: ItemFilters = {},
): Promise<OwnedContentItemRecord[]> {
  const snapshot = await itemCollection().get();
  let items = snapshot.docs.map(mapItem).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (filters.sourceId) items = items.filter((item) => item.source_id === filters.sourceId);
  if (filters.status) items = items.filter((item) => item.status === filters.status);
  if (filters.accountId) {
    const allowedSources = new Set(
      (await listOwnedContentSources({ accountId: filters.accountId, status: "active", limit: 500 }))
        .map((source) => source.id),
    );
    items = items.filter(
      (item) =>
        allowedSources.has(item.source_id) &&
        (!item.allowed_account_ids?.length || item.allowed_account_ids.includes(filters.accountId!)),
    );
  }
  return items.slice(0, filters.limit ?? 100);
}

export async function getOwnedContentItem(id: string) {
  const snapshot = await itemCollection().doc(id).get();
  return snapshot.exists ? mapItem(snapshot) : null;
}

export async function saveOwnedContentItem(args: {
  id?: string;
  expectedUpdatedAt?: string;
  expectedRevision?: number;
  item: Record<string, unknown>;
}): Promise<OwnedContentItemRecord> {
  const ref = args.id ? itemCollection().doc(args.id) : itemCollection().doc();
  const now = nowIso();

  await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    const patch = normalizePatch(args.item);
    if (!existing.exists) {
      for (const key of ["source_id", "title", "canonical_url"]) {
        if (typeof patch[key] !== "string" || !String(patch[key]).trim()) {
          throw new Error(`${key} is required when creating an owned content item.`);
        }
      }
      const source = await transaction.get(sourceCollection().doc(String(patch.source_id)));
      if (!source.exists) throw new Error("Owned content source not found.");
      transaction.set(ref, {
        ...patch,
        status: patch.status ?? "active",
        revision: 1,
        created_at: now,
        updated_at: now,
      });
      return;
    }

    const current = mapItem(existing);
    if (!args.expectedUpdatedAt) throw new Error("expectedUpdatedAt is required for owned content item updates.");
    if (current.updated_at !== args.expectedUpdatedAt) throw new Error("updated_at conflict: refresh and retry.");
    if (args.expectedRevision !== undefined && current.revision !== args.expectedRevision) {
      throw new Error("revision conflict: refresh and retry.");
    }
    if (patch.source_id && patch.source_id !== current.source_id) {
      const source = await transaction.get(sourceCollection().doc(String(patch.source_id)));
      if (!source.exists) throw new Error("Owned content source not found.");
    }
    transaction.update(ref, {
      ...patch,
      revision: current.revision + 1,
      updated_at: now,
    });
  });

  const saved = await ref.get();
  return mapItem(saved);
}

export async function syncOwnedContentItems(args: {
  sourceId: string;
  items: Array<{
    external_content_id?: string;
    title: string;
    canonical_url: string;
    status?: OwnedContentItemStatus;
    themes?: string[];
    allowed_account_ids?: string[];
    persona_fits?: string[];
    distribution_hooks?: string[];
    published_at?: string;
    notes?: string;
  }>;
}) {
  if (args.items.length < 1 || args.items.length > 200) {
    throw new Error("syncOwnedContentItems accepts 1–200 items.");
  }
  const source = await getOwnedContentSource(args.sourceId);
  if (!source) throw new Error("Owned content source not found.");

  const now = nowIso();
  const identities = args.items.map((item) => {
    const identity = item.external_content_id?.trim() || item.canonical_url.trim();
    const id = createHash("sha256")
      .update(`${args.sourceId}:${identity}`)
      .digest("hex")
      .slice(0, 40);
    return { id, item };
  });
  const refs = identities.map(({ id }) => itemCollection().doc(id));
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  const batch = adminDb.batch();

  identities.forEach(({ id, item }, index) => {
    const ref = itemCollection().doc(id);
    const current = snapshots[index].exists ? mapItem(snapshots[index]) : null;
    batch.set(
      ref,
      {
        source_id: args.sourceId,
        ...(item.external_content_id?.trim() ? { external_content_id: item.external_content_id.trim() } : {}),
        title: item.title.trim(),
        canonical_url: item.canonical_url.trim(),
        status: item.status ?? current?.status ?? "active",
        ...(item.themes ? { themes: item.themes } : {}),
        ...(item.allowed_account_ids ? { allowed_account_ids: item.allowed_account_ids } : {}),
        ...(item.persona_fits ? { persona_fits: item.persona_fits } : {}),
        ...(item.distribution_hooks ? { distribution_hooks: item.distribution_hooks } : {}),
        ...(item.published_at ? { published_at: item.published_at } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
        revision: (current?.revision ?? 0) + 1,
        created_at: current?.created_at ?? now,
        updated_at: now,
      },
      { merge: true },
    );
  });
  await batch.commit();

  return {
    sourceId: args.sourceId,
    syncedCount: args.items.length,
    itemIds: identities.map(({ id }) => id),
    updated_at: now,
  };
}

export async function getOwnedContentDistributionWork(
  accountId: string,
  limit = 50,
) {
  const account = await getAccount(accountId);
  if (!account) throw new Error("Account not found.");

  const [sources, allItems, postsSnapshot] = await Promise.all([
    listOwnedContentSources({ accountId, status: "active", limit: 200 }),
    listOwnedContentItems({ accountId, status: "active", limit: Math.max(limit * 5, 100) }),
    adminDb.collection("posts").where("account_id", "==", accountId).limit(500).get(),
  ]);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const performanceByItem = new Map<string, {
    postCount: number;
    impressions: number;
    likes: number;
    replies: number;
    reposts_or_rethreads: number;
    link_clicks: number;
  }>();
  for (const doc of postsSnapshot.docs) {
    const post = doc.data() as PostDoc;
    const itemId = post.owned_content_item_id;
    if (!itemId) continue;
    const current = performanceByItem.get(itemId) ?? {
      postCount: 0,
      impressions: 0,
      likes: 0,
      replies: 0,
      reposts_or_rethreads: 0,
      link_clicks: 0,
    };
    current.postCount += 1;
    current.impressions += Number(post.metrics?.impressions ?? 0);
    current.likes += Number(post.metrics?.likes ?? 0);
    current.replies += Number(post.metrics?.replies ?? 0);
    current.reposts_or_rethreads += Number(post.metrics?.reposts_or_rethreads ?? 0);
    current.link_clicks += Number(post.metrics?.link_clicks ?? 0);
    performanceByItem.set(itemId, current);
  }

  const candidates = allItems
    .map((item) => {
      const source = sourceMap.get(item.source_id);
      if (!source) return null;
      const match = scoreOwnedContent(account, source, item);
      return {
        item,
        source: {
          id: source.id,
          source_type: source.source_type,
          provider: source.provider,
          external_source_id: source.external_source_id ?? null,
          name: source.name,
          base_url: source.base_url ?? null,
        },
        match,
        previousPostCount: performanceByItem.get(item.id)?.postCount ?? 0,
        socialPerformance: performanceByItem.get(item.id) ?? {
          postCount: 0,
          impressions: 0,
          likes: 0,
          replies: 0,
          reposts_or_rethreads: 0,
          link_clicks: 0,
        },
        distributionHooks: unique([...(source.distribution_hooks ?? []), ...(item.distribution_hooks ?? [])]),
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .filter((value) => value.match.eligible)
    .sort((a, b) => {
      if (a.previousPostCount !== b.previousPostCount) return a.previousPostCount - b.previousPostCount;
      return b.match.score - a.match.score;
    })
    .slice(0, limit);

  return {
    accountId,
    sources,
    candidates,
    summary: {
      sourceCount: sources.length,
      eligibleItemCount: candidates.length,
      unusedCandidateCount: candidates.filter((item) => item.previousPostCount === 0).length,
    },
    sourceAbstraction: {
      supportedSourceTypes: ["website", "note", "newsletter", "other"] as OwnedContentSourceType[],
      providerExamples: ["sites_operator", "note", "manual"],
      rule: "Owned content is not an affiliate offer. It may share distribution ranking, but it has no affiliate reward/disclosure semantics by default.",
    },
  };
}
