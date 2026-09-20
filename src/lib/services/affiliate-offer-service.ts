import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import { publishXReply } from "@/lib/platforms/x";
import { publishThreadsReply } from "@/lib/platforms/threads";
import {
  fetchRecentPosts,
  getAccount,
  getAccounts,
} from "@/lib/services/firestore.server";
import { getAffiliateDistributionRuntimeState } from "@/lib/services/project-context-service";
import type { AccountDoc, PostDoc } from "@/lib/types";
import {
  allowsAffiliateOfferReply,
  composeAffiliateReplyText,
  getAffiliateReplyPublishAction,
  isReplyOccupyingParent,
  matchAffiliateOffer,
  passesPromoReplyRate,
  resolvePromoReplyMode,
  validateDisclosure,
  type AffiliateAccountSettings,
  type AffiliateOfferPerformance,
  type AffiliateOfferRecord,
  type AffiliateReplyRecord,
  type AffiliateReplyStatus,
} from "@/lib/affiliate-distribution-policy";

const DEFAULT_DAILY_PROMO_LIMIT = 2;
const DEFAULT_ACCOUNT_COOLDOWN_MINUTES = 60;
const DEFAULT_OFFER_COOLDOWN_MINUTES = 60;
const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_MIN_SCORE = 1000;
const DEFAULT_MIN_IMPRESSIONS = 1000;

type OfferFilters = {
  status?: string;
  network?: string;
  category?: string;
  accountId?: string;
  platform?: "x" | "threads";
  kind?: string;
  limit?: number;
};

type SaveOfferArgs = {
  id?: string;
  expectedUpdatedAt?: string;
  expectedRevision?: number;
  offer: Record<string, unknown>;
};

type ReplyWorkArgs = {
  accountId?: string;
  postLimit?: number;
  offerLimit?: number;
};

type CreateReplyDraftArgs = {
  parentPostId: string;
  offerId: string;
  text: string;
  disclosure: string;
  hookVersion?: string;
};

type ReconcileReplyArgs = {
  platformReplyId?: string;
  platformUrl?: string;
  confirmNotPublished?: boolean;
};

type PerformanceUpdate = {
  mode?: "increment" | "set";
  parentPostImpressions?: number;
  replyImpressions?: number;
  likes?: number;
  replies?: number;
  clicks?: number;
  conversions?: number;
  revenue?: number;
  bestHook?: string;
  bestAccount?: string;
};

function offerCollection() {
  return adminDb.collection("affiliate_offers");
}

function affiliateReplyCollection() {
  return adminDb.collection("affiliate_replies");
}

function nowIso() {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function mapOffer(
  doc: FirebaseFirestore.DocumentSnapshot,
): AffiliateOfferRecord {
  return { id: doc.id, ...(doc.data() ?? {}) } as AffiliateOfferRecord;
}

function mapReply(
  doc: FirebaseFirestore.DocumentSnapshot,
): AffiliateReplyRecord {
  return { id: doc.id, ...(doc.data() ?? {}) } as AffiliateReplyRecord;
}

function toAccountSettings(account: AccountDoc): AccountDoc & AffiliateAccountSettings {
  return account as AccountDoc & AffiliateAccountSettings;
}

function normalizeOfferPatch(
  offer: Record<string, unknown>,
): Record<string, unknown> {
  const patch = { ...offer };
  delete patch.id;
  delete patch.created_at;
  delete patch.updated_at;
  delete patch.revision;
  return stripUndefined(patch);
}

function assertCreateRequiredFields(offer: Record<string, unknown>) {
  for (const key of ["kind", "network", "title"]) {
    if (typeof offer[key] !== "string" || !String(offer[key]).trim()) {
      throw new Error(`${key} is required when creating an affiliate offer.`);
    }
  }
}

function parseDate(value?: string): DateTime | null {
  if (!value) return null;
  const parsed = DateTime.fromISO(value);
  return parsed.isValid ? parsed : null;
}

function isPublishedLike(status: AffiliateReplyStatus): boolean {
  return (
    status === "publishing" ||
    status === "pending_reconciliation" ||
    status === "published" ||
    status === "reconciled"
  );
}

function startedToday(value: string, now: DateTime): boolean {
  const date = DateTime.fromISO(value);
  if (!date.isValid) return false;
  const start = now.setZone("Asia/Tokyo").startOf("day").toUTC();
  return date.toUTC().toMillis() >= start.toMillis();
}

function parentGateReasons(
  account: AccountDoc & AffiliateAccountSettings,
  post: PostDoc,
  now: DateTime,
): string[] {
  const reasons: string[] = [];
  if (account.promoReplyEnabled !== true) reasons.push("promo_reply_disabled");
  if (!allowsAffiliateOfferReply(account)) reasons.push("affiliate_offer_mode_disabled");
  if (post.promo_replied_at) reasons.push("parent_already_promo_replied");
  if (post.metrics.impressions == null) {
    reasons.push("impressions_unavailable");
  } else if (
    post.metrics.impressions <
    (account.promoReplyMinImpressions ?? DEFAULT_MIN_IMPRESSIONS)
  ) {
    reasons.push("below_min_impressions");
  }
  if (post.score < (account.promoReplyMinScore ?? DEFAULT_MIN_SCORE)) {
    reasons.push("below_min_score");
  }
  const created = DateTime.fromISO(post.created_at);
  if (!created.isValid) {
    reasons.push("invalid_parent_created_at");
  } else if (
    now.diff(created, "days").days >
    (account.promoReplyLookbackDays ?? DEFAULT_LOOKBACK_DAYS)
  ) {
    reasons.push("outside_lookback");
  }
  const rate =
    account.promoReplyRate ??
    account.promoRate ??
    1;
  if (!passesPromoReplyRate(account.id, post.id, rate)) {
    reasons.push("promo_reply_rate_gate");
  }
  return reasons;
}

async function loadAffiliateReplies(): Promise<AffiliateReplyRecord[]> {
  const snapshot = await affiliateReplyCollection().get();
  return snapshot.docs
    .map(mapReply)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function accountRuntimeBlockReasons(
  account: AccountDoc & AffiliateAccountSettings,
  replies: AffiliateReplyRecord[],
  now: DateTime,
  exceptReplyId?: string,
): string[] {
  const reasons: string[] = [];
  const dailyLimit = account.promoReplyDailyLimit ?? DEFAULT_DAILY_PROMO_LIMIT;
  const todayCount = replies.filter(
    (reply) =>
      reply.account_id === account.id &&
      reply.id !== exceptReplyId &&
      isPublishedLike(reply.status) &&
      startedToday(reply.created_at, now),
  ).length;
  if (todayCount >= dailyLimit) reasons.push("daily_promo_limit");

  const lastReply = parseDate(account.lastPromoReplyAt);
  const cooldownMinutes =
    account.promoReplyCooldownMinutes ?? DEFAULT_ACCOUNT_COOLDOWN_MINUTES;
  if (
    lastReply &&
    now.diff(lastReply, "minutes").minutes < cooldownMinutes
  ) {
    reasons.push("account_cooldown");
  }
  return reasons;
}

function offerCooldownBlocked(
  offer: AffiliateOfferRecord,
  replies: AffiliateReplyRecord[],
  now: DateTime,
  exceptReplyId?: string,
): boolean {
  const cooldown =
    offer.offerCooldownMinutes ?? DEFAULT_OFFER_COOLDOWN_MINUTES;
  const last = replies
    .filter(
      (reply) =>
        reply.offer_id === offer.id &&
        reply.id !== exceptReplyId &&
        isPublishedLike(reply.status),
    )
    .map((reply) => DateTime.fromISO(reply.created_at))
    .filter((value) => value.isValid)
    .sort((a, b) => b.toMillis() - a.toMillis())[0];
  return Boolean(last && now.diff(last, "minutes").minutes < cooldown);
}

function existingParentReply(
  parentPostId: string,
  replies: AffiliateReplyRecord[],
  exceptReplyId?: string,
): AffiliateReplyRecord | null {
  return (
    replies.find(
      (reply) =>
        reply.parent_post_id === parentPostId &&
        reply.id !== exceptReplyId &&
        isReplyOccupyingParent(reply.status),
    ) ?? null
  );
}

export async function listAffiliateOffers(
  filters: OfferFilters = {},
): Promise<AffiliateOfferRecord[]> {
  const snapshot = await offerCollection().get();
  let items = snapshot.docs
    .map(mapOffer)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  if (filters.status) {
    items = items.filter((item) => item.status === filters.status);
  }
  if (filters.network) {
    items = items.filter((item) => item.network === filters.network);
  }
  if (filters.category) {
    items = items.filter((item) => item.category === filters.category);
  }
  if (filters.kind) {
    items = items.filter((item) => item.kind === filters.kind);
  }
  if (filters.accountId) {
    items = items.filter(
      (item) =>
        !item.allowedAccountIds?.length ||
        item.allowedAccountIds.includes(filters.accountId!),
    );
  }
  if (filters.platform) {
    items = items.filter(
      (item) =>
        !item.allowedPlatforms?.length ||
        item.allowedPlatforms.includes(filters.platform!),
    );
  }
  return items.slice(0, filters.limit ?? 50);
}

export async function getAffiliateOffer(
  id: string,
): Promise<AffiliateOfferRecord | null> {
  const snapshot = await offerCollection().doc(id).get();
  return snapshot.exists ? mapOffer(snapshot) : null;
}

export async function saveAffiliateOffer({
  id,
  expectedUpdatedAt,
  expectedRevision,
  offer,
}: SaveOfferArgs): Promise<AffiliateOfferRecord> {
  const ref = id ? offerCollection().doc(id) : offerCollection().doc();
  const now = nowIso();

  await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    const patch = normalizeOfferPatch(offer);

    if (!existing.exists) {
      assertCreateRequiredFields(patch);
      transaction.set(ref, {
        ...patch,
        status: patch.status ?? "candidate",
        revision: 1,
        created_at: now,
        updated_at: now,
      });
      return;
    }

    const current = mapOffer(existing);
    if (!expectedUpdatedAt) {
      throw new Error("expectedUpdatedAt is required for affiliate offer updates.");
    }
    if (current.updated_at !== expectedUpdatedAt) {
      throw new Error("updated_at conflict: refresh and retry.");
    }
    if (
      expectedRevision !== undefined &&
      current.revision !== expectedRevision
    ) {
      throw new Error("revision conflict: refresh and retry.");
    }

    transaction.update(ref, {
      ...patch,
      revision: (current.revision ?? 0) + 1,
      updated_at: now,
    });
  });

  const saved = await ref.get();
  if (!saved.exists) throw new Error("Affiliate offer save failed.");
  return mapOffer(saved);
}

export async function archiveAffiliateOffer(
  id: string,
  expectedUpdatedAt: string,
  reason?: string,
): Promise<AffiliateOfferRecord> {
  const current = await getAffiliateOffer(id);
  if (!current) throw new Error("Affiliate offer not found.");
  return saveAffiliateOffer({
    id,
    expectedUpdatedAt,
    expectedRevision: current.revision,
    offer: {
      status: "archived",
      ...(reason ? { notes: [current.notes, `Archived: ${reason}`].filter(Boolean).join("\n") } : {}),
    },
  });
}

export async function getAffiliateReplyWork({
  accountId,
  postLimit = 20,
  offerLimit = 50,
}: ReplyWorkArgs = {}) {
  const now = DateTime.utc();
  const [allOffers, allReplies, allAccounts, distributionRuntime] = await Promise.all([
    listAffiliateOffers({ limit: Math.min(Math.max(offerLimit, 1), 200) }),
    loadAffiliateReplies(),
    getAccounts(),
    getAffiliateDistributionRuntimeState(),
  ]);
  const accounts = accountId
    ? allAccounts.filter((account) => account.id === accountId)
    : allAccounts;

  const candidatePosts: Array<Record<string, unknown>> = [];
  const accountSummaries: Array<Record<string, unknown>> = [];

  for (const rawAccount of accounts) {
    const account = toAccountSettings(rawAccount);
    const posts = await fetchRecentPosts(
      account.id,
      Math.min(Math.max(postLimit, 1), 50),
    );
    const runtimeBlocks = accountRuntimeBlockReasons(account, allReplies, now);
    if (!distributionRuntime.offerRepliesEnabled && distributionRuntime.blockReason) {
      runtimeBlocks.push(distributionRuntime.blockReason);
    }
    accountSummaries.push({
      accountId: account.id,
      platform: account.platform,
      monetizationThemes: account.monetizationThemes ?? [],
      promoEnabled: account.promoEnabled === true,
      promoReplyEnabled: account.promoReplyEnabled === true,
      promoReplyMode: resolvePromoReplyMode(account),
      promoReplyRate: account.promoReplyRate ?? account.promoRate ?? 1,
      promoReplyDailyLimit:
        account.promoReplyDailyLimit ?? DEFAULT_DAILY_PROMO_LIMIT,
      runtimeBlocks,
    });

    for (const post of posts) {
      const blockReasons = [
        ...parentGateReasons(account, post, now),
        ...runtimeBlocks,
      ];
      const priorReply = existingParentReply(post.id, allReplies);
      if (priorReply) blockReasons.push("existing_affiliate_reply");

      const ranked = allOffers
        .map((offer) => {
          const match = matchAffiliateOffer(account, post, offer, now);
          const offerBlocks = [...match.blockReasons];
          if (offerCooldownBlocked(offer, allReplies, now)) {
            offerBlocks.push("offer_cooldown");
          }
          return {
            offer: {
              id: offer.id,
              kind: offer.kind,
              network: offer.network,
              advertiser: offer.advertiser ?? null,
              title: offer.title,
              category: offer.category ?? null,
              themes: offer.themes ?? [],
              conversionAction: offer.conversionAction ?? null,
              reward: offer.reward ?? null,
              affiliateUrl: offer.affiliateUrl ?? null,
              disclosureText: offer.disclosureText ?? null,
              status: offer.status,
              updated_at: offer.updated_at,
            },
            matchScore: match.score,
            fitReasons: match.reasons,
            blockReasons: Array.from(new Set(offerBlocks)),
            eligible: match.eligible && offerBlocks.length === 0,
          };
        })
        .sort(
          (a, b) =>
            Number(b.eligible) - Number(a.eligible) ||
            b.matchScore - a.matchScore,
        );

      const eligibleOffers =
        blockReasons.length === 0
          ? ranked.filter((item) => item.eligible).slice(0, 10)
          : [];
      const blockedOffers = ranked
        .filter((item) => !item.eligible)
        .slice(0, 5);

      candidatePosts.push({
        post: {
          id: post.id,
          platformPostId: post.platform_post_id,
          accountId: post.account_id,
          platform: post.platform,
          text: post.text,
          createdAt: post.created_at,
          impressions: post.metrics.impressions,
          score: post.score,
          promoRepliedAt: post.promo_replied_at ?? null,
        },
        account: {
          id: account.id,
          handle: account.handle,
          displayName: account.display_name,
          monetizationThemes: account.monetizationThemes ?? [],
        },
        hasAffiliateReply: Boolean(priorReply),
        existingAffiliateReply: priorReply
          ? {
              id: priorReply.id,
              status: priorReply.status,
              offerId: priorReply.offer_id,
              platformReplyId: priorReply.platform_reply_id ?? null,
            }
          : null,
        eligibleForReply:
          blockReasons.length === 0 && eligibleOffers.length > 0,
        blockReasons: Array.from(new Set(blockReasons)),
        eligibleOffers,
        blockedOffers,
      });
    }
  }

  candidatePosts.sort(
    (a, b) =>
      Number(b.eligibleForReply) - Number(a.eligibleForReply) ||
      Number((b.post as Record<string, unknown>).score ?? 0) -
        Number((a.post as Record<string, unknown>).score ?? 0),
  );

  return {
    generatedAt: now.toISO(),
    candidatePosts,
    accounts: accountSummaries,
    offerCatalog: {
      total: allOffers.length,
      active: allOffers.filter((offer) => offer.status === "active").length,
      candidate: allOffers.filter((offer) => offer.status === "candidate").length,
      pendingApproval: allOffers.filter(
        (offer) => offer.status === "pending_approval",
      ).length,
    },
    distributionRuntime,
    semantics: {
      promoRate:
        "Affiliate Distribution uses promoReplyRate when present; promoRate is a backward-compatible fallback. It means the deterministic fraction of otherwise eligible viral parent posts that may receive a promo reply.",
      productIsolation:
        "Amazon /products remains the legacy physical-product domain. /affiliate_offers is the generic service/lead/subscription/owned-product domain.",
      promoReplyMode:
        "off blocks all commerce replies; amazon allows legacy Amazon replies; affiliate_offer allows Affiliate Offer replies; mixed allows both. Unset resolves to amazon for backward compatibility.",
    },
  };
}

async function getParentPost(parentPostId: string): Promise<PostDoc> {
  const snapshot = await adminDb.collection("posts").doc(parentPostId).get();
  if (!snapshot.exists) throw new Error("Parent post not found.");
  return { id: snapshot.id, ...snapshot.data() } as PostDoc;
}

async function assertReplyCreationGates(
  account: AccountDoc & AffiliateAccountSettings,
  post: PostDoc,
  offer: AffiliateOfferRecord,
  disclosure: string,
  allReplies: AffiliateReplyRecord[],
) {
  const now = DateTime.utc();
  const distributionRuntime = await getAffiliateDistributionRuntimeState();
  const parentBlocks = [
    ...parentGateReasons(account, post, now),
    ...accountRuntimeBlockReasons(account, allReplies, now),
  ];
  if (!distributionRuntime.offerRepliesEnabled && distributionRuntime.blockReason) {
    parentBlocks.push(distributionRuntime.blockReason);
  }
  if (existingParentReply(post.id, allReplies)) {
    parentBlocks.push("existing_affiliate_reply");
  }
  const match = matchAffiliateOffer(account, post, offer, now);
  if (offerCooldownBlocked(offer, allReplies, now)) {
    match.blockReasons.push("offer_cooldown");
  }
  const disclosureCheck = validateDisclosure(disclosure, offer);
  if (!disclosureCheck.ok) {
    match.blockReasons.push(disclosureCheck.reason ?? "invalid_disclosure");
  }
  const blocks = Array.from(
    new Set([...parentBlocks, ...match.blockReasons]),
  );
  if (blocks.length > 0) {
    throw new Error(
      `Affiliate reply is not eligible: ${blocks.join(", ")}`,
    );
  }
}

export async function createAffiliateReplyDraft({
  parentPostId,
  offerId,
  text,
  disclosure,
  hookVersion,
}: CreateReplyDraftArgs): Promise<AffiliateReplyRecord> {
  const [post, offer, allReplies] = await Promise.all([
    getParentPost(parentPostId),
    getAffiliateOffer(offerId),
    loadAffiliateReplies(),
  ]);
  if (!offer) throw new Error("Affiliate offer not found.");
  const rawAccount = await getAccount(post.account_id);
  if (!rawAccount) throw new Error("Account not found.");
  const account = toAccountSettings(rawAccount);

  await assertReplyCreationGates(
    account,
    post,
    offer,
    disclosure,
    allReplies,
  );

  const fullText = composeAffiliateReplyText(text, disclosure);
  const affiliateUrl = offer.affiliateUrl?.trim();
  if (!affiliateUrl || !fullText.includes(affiliateUrl)) {
    throw new Error(
      "Reply text must contain the offer affiliateUrl before it can be drafted.",
    );
  }

  const now = nowIso();
  const ref = affiliateReplyCollection().doc();
  const reply: AffiliateReplyRecord = {
    id: ref.id,
    offer_id: offer.id,
    parent_post_id: post.id,
    account_id: account.id,
    platform: post.platform,
    parent_platform_post_id: post.platform_post_id,
    text: text.trim(),
    disclosure: disclosure.trim(),
    full_text: fullText,
    status: "draft",
    ...(hookVersion ? { hook_version: hookVersion } : {}),
    created_at: now,
    updated_at: now,
  };
  await ref.set(reply);
  return reply;
}

async function recordOfferReplyAttempt(offerId: string) {
  const ref = offerCollection().doc(offerId);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Affiliate offer not found.");
    const offer = mapOffer(snapshot);
    const performance: AffiliateOfferPerformance = {
      ...(offer.performance ?? {}),
      reply_attempts: (offer.performance?.reply_attempts ?? 0) + 1,
    };
    transaction.update(ref, {
      performance,
      updated_at: nowIso(),
    });
  });
}

async function finalizeReplyLink(
  replyId: string,
  reconciled: boolean,
): Promise<AffiliateReplyRecord> {
  const replyRef = affiliateReplyCollection().doc(replyId);
  const now = nowIso();

  await adminDb.runTransaction(async (transaction) => {
    const replySnapshot = await transaction.get(replyRef);
    if (!replySnapshot.exists) throw new Error("Affiliate reply not found.");
    const reply = mapReply(replySnapshot);
    if (reply.status === "published" || reply.status === "reconciled") return;
    if (!reply.platform_reply_id) {
      throw new Error("platformReplyId is required before link reconciliation.");
    }

    const offerRef = offerCollection().doc(reply.offer_id);
    const parentRef = adminDb.collection("posts").doc(reply.parent_post_id);
    const accountRef = adminDb.collection("accounts").doc(reply.account_id);
    const [offerSnapshot, parentSnapshot, accountSnapshot] = await Promise.all([
      transaction.get(offerRef),
      transaction.get(parentRef),
      transaction.get(accountRef),
    ]);
    if (!offerSnapshot.exists) throw new Error("Affiliate offer not found.");
    if (!parentSnapshot.exists) throw new Error("Parent post not found.");
    if (!accountSnapshot.exists) throw new Error("Account not found.");

    const offer = mapOffer(offerSnapshot);
    const performance: AffiliateOfferPerformance = {
      ...(offer.performance ?? {}),
      published_replies: (offer.performance?.published_replies ?? 0) + 1,
      parent_post_impressions:
        (offer.performance?.parent_post_impressions ?? 0) +
        Number((parentSnapshot.data() as PostDoc).metrics?.impressions ?? 0),
      last_published_at: now,
      last_account_id: reply.account_id,
      reply_ids: Array.from(
        new Set([...(offer.performance?.reply_ids ?? []), reply.id]),
      ),
    };

    transaction.update(replyRef, {
      status: reconciled ? "reconciled" : "published",
      published_at: reply.published_at ?? now,
      ...(reconciled ? { reconciled_at: now } : {}),
      error: null,
      updated_at: now,
    });
    transaction.set(
      parentRef,
      {
        affiliate_reply_id: reply.id,
        affiliate_offer_id: reply.offer_id,
        affiliate_reply_platform_id: reply.platform_reply_id,
        promo_replied_at: reply.published_at ?? now,
      },
      { merge: true },
    );
    transaction.set(
      accountRef,
      {
        lastPromoReplyAt: reply.published_at ?? now,
        updated_at: now,
      },
      { merge: true },
    );
    transaction.update(offerRef, {
      performance,
      updated_at: now,
    });
  });

  const saved = await replyRef.get();
  return mapReply(saved);
}

async function revalidatePublishGates(
  reply: AffiliateReplyRecord,
): Promise<{
  account: AccountDoc & AffiliateAccountSettings;
  post: PostDoc;
  offer: AffiliateOfferRecord;
}> {
  const [post, offer, allReplies] = await Promise.all([
    getParentPost(reply.parent_post_id),
    getAffiliateOffer(reply.offer_id),
    loadAffiliateReplies(),
  ]);
  if (!offer) throw new Error("Affiliate offer not found.");
  const rawAccount = await getAccount(reply.account_id);
  if (!rawAccount) throw new Error("Account not found.");
  const account = toAccountSettings(rawAccount);

  const duplicate = existingParentReply(
    reply.parent_post_id,
    allReplies,
    reply.id,
  );
  if (duplicate) throw new Error("Parent post already has an affiliate reply.");

  const now = DateTime.utc();
  const distributionRuntime = await getAffiliateDistributionRuntimeState();
  const blocks = [
    ...parentGateReasons(account, post, now),
    ...accountRuntimeBlockReasons(account, allReplies, now, reply.id),
  ];
  if (!distributionRuntime.offerRepliesEnabled && distributionRuntime.blockReason) {
    blocks.push(distributionRuntime.blockReason);
  }
  const match = matchAffiliateOffer(account, post, offer, now);
  blocks.push(...match.blockReasons);
  if (offerCooldownBlocked(offer, allReplies, now, reply.id)) {
    blocks.push("offer_cooldown");
  }
  const disclosureCheck = validateDisclosure(reply.disclosure, offer);
  if (!disclosureCheck.ok) {
    blocks.push(disclosureCheck.reason ?? "invalid_disclosure");
  }
  if (!offer.affiliateUrl?.trim() || !reply.full_text.includes(offer.affiliateUrl.trim())) {
    blocks.push("affiliate_url_missing_from_reply");
  }
  if (blocks.length > 0) {
    throw new Error(
      `Affiliate reply publish blocked: ${Array.from(new Set(blocks)).join(", ")}`,
    );
  }
  return { account, post, offer };
}

async function claimReplyForPublish(
  replyId: string,
  expectedUpdatedAt: string,
): Promise<AffiliateReplyRecord> {
  const ref = affiliateReplyCollection().doc(replyId);
  const now = nowIso();
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Affiliate reply draft not found.");
    const reply = mapReply(snapshot);
    if (reply.updated_at !== expectedUpdatedAt) {
      throw new Error("updated_at conflict: refresh and retry.");
    }
    const action = getAffiliateReplyPublishAction(reply.status);
    if (action !== "publish") return reply;
    transaction.update(ref, {
      status: "publishing",
      publish_started_at: now,
      updated_at: now,
      error: null,
    });
    return { ...reply, status: "publishing", publish_started_at: now, updated_at: now };
  });
}

export async function publishAffiliateReply(
  replyId: string,
  expectedUpdatedAt: string,
) {
  const before = await affiliateReplyCollection().doc(replyId).get();
  if (!before.exists) throw new Error("Affiliate reply draft not found.");
  const existing = mapReply(before);
  const existingAction = getAffiliateReplyPublishAction(existing.status);

  if (existingAction === "already_published") {
    return { reply: existing, status: "already_published", externalPostCreated: false };
  }
  if (existingAction === "reconcile_only") {
    if (existing.platform_reply_id) {
      return {
        reply: await finalizeReplyLink(replyId, true),
        status: "reconciled",
        externalPostCreated: false,
      };
    }
    return {
      reply: existing,
      status: "reconciliation_required",
      externalPostCreated: false,
      noRetryPublish: true,
      nextAction:
        "Do not call publish_affiliate_reply again. Resolve the external reply ID, then call reconcile_affiliate_reply.",
    };
  }
  if (existingAction === "blocked") {
    throw new Error(`Affiliate reply cannot be published from status ${existing.status}.`);
  }

  await revalidatePublishGates(existing);
  const claimed = await claimReplyForPublish(replyId, expectedUpdatedAt);
  if (getAffiliateReplyPublishAction(claimed.status) === "reconcile_only" && claimed.platform_reply_id) {
    return {
      reply: await finalizeReplyLink(replyId, true),
      status: "reconciled",
      externalPostCreated: false,
    };
  }

  const { account, post } = await revalidatePublishGates(claimed);
  await recordOfferReplyAttempt(claimed.offer_id);

  let published;
  try {
    published =
      post.platform === "x"
        ? await publishXReply(account, {
            text: claimed.full_text,
            replyToId: post.platform_post_id,
          })
        : await publishThreadsReply(account, {
            text: claimed.full_text,
            replyToId: post.platform_post_id,
          });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await affiliateReplyCollection()
      .doc(replyId)
      .set(
        {
          status: "pending_reconciliation",
          error: message,
          updated_at: nowIso(),
        },
        { merge: true },
      )
      .catch(() => undefined);
    return {
      replyId,
      status: "reconciliation_required",
      externalPostCreated: "unknown",
      noRetryPublish: true,
      error: message,
      nextAction:
        "The platform result is ambiguous. Do not retry publishing. Reconcile the external reply first; if confirmed absent, call reconcile_affiliate_reply with confirmNotPublished=true.",
    };
  }

  const publishedAt = nowIso();
  try {
    await affiliateReplyCollection().doc(replyId).set(
      {
        status: "pending_reconciliation",
        platform_reply_id: published.platform_post_id,
        platform_url: published.url ?? null,
        published_at: publishedAt,
        updated_at: publishedAt,
        error: null,
      },
      { merge: true },
    );
  } catch (error) {
    return {
      replyId,
      status: "external_published_unpersisted",
      externalPostCreated: true,
      platformReplyId: published.platform_post_id,
      platformUrl: published.url ?? null,
      noRetryPublish: true,
      persistenceError:
        error instanceof Error ? error.message : String(error),
      nextAction:
        "Do not publish again. Call reconcile_affiliate_reply with this platformReplyId to restore Firestore attribution.",
    };
  }

  try {
    const reply = await finalizeReplyLink(replyId, false);
    return {
      reply,
      status: "published",
      externalPostCreated: true,
      platformReplyId: published.platform_post_id,
    };
  } catch (error) {
    return {
      replyId,
      status: "pending_reconciliation",
      externalPostCreated: true,
      platformReplyId: published.platform_post_id,
      platformUrl: published.url ?? null,
      noRetryPublish: true,
      persistenceError:
        error instanceof Error ? error.message : String(error),
      nextAction:
        "The external reply exists. Do not publish again. Call reconcile_affiliate_reply to finish Offer ↔ Reply ↔ Parent attribution.",
    };
  }
}

export async function reconcileAffiliateReply(
  replyId: string,
  options: ReconcileReplyArgs,
) {
  const ref = affiliateReplyCollection().doc(replyId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error("Affiliate reply not found.");
  const reply = mapReply(snapshot);
  if (reply.status === "published" || reply.status === "reconciled") {
    return { reply, status: "already_linked" };
  }

  if (options.confirmNotPublished === true) {
    const updated = nowIso();
    await ref.set(
      {
        status: "failed",
        error: "Explicitly confirmed not published on the external platform.",
        updated_at: updated,
      },
      { merge: true },
    );
    const saved = await ref.get();
    return {
      reply: mapReply(saved),
      status: "confirmed_not_published",
      nextAction: "A new draft for the parent post may now be created if it is still eligible.",
    };
  }

  const platformReplyId =
    options.platformReplyId?.trim() || reply.platform_reply_id?.trim();
  if (!platformReplyId) {
    return {
      reply,
      status: "needs_platform_reply_id",
      noRetryPublish: true,
      nextAction:
        "Resolve whether the external reply exists. If it does, provide platformReplyId. If it does not, explicitly confirmNotPublished.",
    };
  }

  await ref.set(
    {
      status: "pending_reconciliation",
      platform_reply_id: platformReplyId,
      ...(options.platformUrl ? { platform_url: options.platformUrl } : {}),
      published_at: reply.published_at ?? nowIso(),
      updated_at: nowIso(),
    },
    { merge: true },
  );
  return {
    reply: await finalizeReplyLink(replyId, true),
    status: "reconciled",
  };
}

export async function updateAffiliateOfferPerformance(
  offerId: string,
  expectedUpdatedAt: string,
  update: PerformanceUpdate,
): Promise<AffiliateOfferRecord> {
  const ref = offerCollection().doc(offerId);
  const numericMap: Array<
    [keyof PerformanceUpdate, keyof AffiliateOfferPerformance]
  > = [
    ["parentPostImpressions", "parent_post_impressions"],
    ["replyImpressions", "reply_impressions"],
    ["likes", "likes"],
    ["replies", "replies"],
    ["clicks", "clicks"],
    ["conversions", "conversions"],
    ["revenue", "revenue"],
  ];

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Affiliate offer not found.");
    const offer = mapOffer(snapshot);
    if (offer.updated_at !== expectedUpdatedAt) {
      throw new Error("updated_at conflict: refresh and retry.");
    }
    const performance: AffiliateOfferPerformance = {
      ...(offer.performance ?? {}),
    };
    for (const [inputKey, outputKey] of numericMap) {
      const value = update[inputKey];
      if (typeof value !== "number") continue;
      const existingValue = Number(performance[outputKey] ?? 0);
      performance[outputKey] =
        update.mode === "set" ? value : existingValue + value;
    }
    if (update.bestHook !== undefined) performance.best_hook = update.bestHook;
    if (update.bestAccount !== undefined) {
      performance.best_account = update.bestAccount;
    }
    transaction.update(ref, {
      performance,
      updated_at: nowIso(),
    });
  });

  const saved = await ref.get();
  return mapOffer(saved);
}
