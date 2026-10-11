import { DateTime } from "luxon";
import type { AccountDoc, Platform, PostDoc, PromoReplyMode } from "@/lib/types";

export type AffiliateOfferKind =
  | "amazon_product"
  | "service"
  | "lead"
  | "subscription"
  | "digital_product"
  | "owned_product";

export type AffiliateOfferStatus =
  | "candidate"
  | "pending_approval"
  | "approved"
  | "active"
  | "paused"
  | "archived";

export type AffiliateRewardType = "fixed" | "percentage" | "variable";

export interface AffiliateOfferReward {
  amount?: number;
  currency?: string;
  type?: AffiliateRewardType;
  description?: string;
}

export interface AffiliateOfferPerformance {
  reply_attempts?: number;
  published_replies?: number;
  parent_post_impressions?: number;
  reply_impressions?: number;
  likes?: number;
  replies?: number;
  clicks?: number;
  conversions?: number;
  revenue?: number;
  best_hook?: string;
  best_account?: string;
  last_published_at?: string;
  last_account_id?: string;
  reply_ids?: string[];
  [key: string]: unknown;
}

export interface AffiliateOfferRecord {
  id: string;
  kind: AffiliateOfferKind;
  network: string;
  advertiser?: string;
  programId?: string;
  sourceProductId?: string;
  title: string;
  description?: string;
  destinationUrl?: string;
  affiliateUrl?: string;
  category?: string;
  themes?: string[];
  conversionAction?: string;
  reward?: AffiliateOfferReward;
  status: AffiliateOfferStatus;
  allowedPlatforms?: Platform[];
  allowedAccountIds?: string[];
  personaFits?: string[];
  promoHooks?: string[];
  prohibitedClaims?: string[];
  disclosureText?: string;
  validFrom?: string;
  validUntil?: string;
  sourceUrl?: string;
  notes?: string;
  offerCooldownMinutes?: number;
  performance?: AffiliateOfferPerformance;
  revision: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export type AffiliateReplyStatus =
  | "draft"
  | "publishing"
  | "pending_reconciliation"
  | "published"
  | "failed"
  | "reconciled";

export interface AffiliateReplyRecord {
  id: string;
  offer_id: string;
  parent_post_id: string;
  account_id: string;
  platform: Platform;
  parent_platform_post_id: string;
  text: string;
  disclosure: string;
  full_text: string;
  status: AffiliateReplyStatus;
  platform_reply_id?: string;
  platform_url?: string;
  hook_version?: string;
  publish_started_at?: string;
  published_at?: string;
  reconciled_at?: string;
  created_at: string;
  updated_at: string;
  error?: string;
  [key: string]: unknown;
}

export type AffiliateAccountSettings = {
  monetizationThemes?: string[];
  affiliateThirdPartyEnabled?: boolean;
  promoReplyRate?: number;
  promoReplyDailyLimit?: number;
  promoReplyMode?: PromoReplyMode;
};

export function resolvePromoReplyMode(
  account: { promoReplyMode?: PromoReplyMode },
): PromoReplyMode {
  return account.promoReplyMode ?? "amazon";
}

export function allowsAmazonPromoReply(
  account: { promoReplyMode?: PromoReplyMode },
): boolean {
  const mode = resolvePromoReplyMode(account);
  return mode === "amazon" || mode === "mixed";
}

export function allowsAffiliateOfferReply(
  account: { promoReplyMode?: PromoReplyMode },
): boolean {
  const mode = resolvePromoReplyMode(account);
  return mode === "affiliate_offer" || mode === "mixed";
}

export type AffiliateOfferMatch = {
  eligible: boolean;
  score: number;
  reasons: string[];
  blockReasons: string[];
  themeOverlap: string[];
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

const THEME_ALIASES: Record<string, string> = {
  love: "relationship",
  relationship: "relationship",
  恋愛: "relationship",
  恋愛相談: "relationship",
  復縁: "relationship",
  fidelity: "fidelity",
  不倫相談: "fidelity",
  浮気: "fidelity",
  consultation: "consultation",
  相談: "consultation",
  悩み相談: "consultation",
  チャット相談: "consultation",
  fortune_telling: "fortune_telling",
  占い: "fortune_telling",
  電話占い: "fortune_telling",
};

function normalizedTheme(value: string): string {
  const token = normalized(value).replace(/\s+/g, "_");
  return THEME_ALIASES[token] ?? token;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function isThirdPartyOffer(offer: AffiliateOfferRecord): boolean {
  return offer.kind !== "owned_product";
}

export function getAccountMonetizationThemes(
  account: AccountDoc & AffiliateAccountSettings,
): string[] {
  return unique((account.monetizationThemes ?? []).map(normalizedTheme));
}

export function getOfferThemes(offer: AffiliateOfferRecord): string[] {
  return unique((offer.themes ?? []).map(normalizedTheme));
}

export function getOfferTemporalBlockReasons(
  offer: AffiliateOfferRecord,
  now: DateTime,
): string[] {
  const reasons: string[] = [];
  if (offer.status !== "active") {
    reasons.push(`offer_status_${offer.status}`);
  }
  if (offer.validFrom) {
    const start = DateTime.fromISO(offer.validFrom);
    if (start.isValid && now.toMillis() < start.toMillis()) reasons.push("offer_not_started");
  }
  if (offer.validUntil) {
    const end = DateTime.fromISO(offer.validUntil);
    if (end.isValid && now.toMillis() >= end.toMillis()) reasons.push("offer_expired");
  }
  if (!offer.affiliateUrl?.trim()) reasons.push("affiliate_url_missing");
  return reasons;
}

function textContainsTheme(text: string, theme: string): boolean {
  const haystack = normalized(text);
  const token = normalized(theme.replace(/_/g, " "));
  if (!token || token.length < 3) return false;
  return haystack.includes(token);
}

export function matchAffiliateOffer(
  account: AccountDoc & AffiliateAccountSettings,
  post: PostDoc,
  offer: AffiliateOfferRecord,
  now: DateTime = DateTime.utc(),
): AffiliateOfferMatch {
  const blockReasons = getOfferTemporalBlockReasons(offer, now);
  if (!allowsAffiliateOfferReply(account)) {
    blockReasons.push("affiliate_offer_mode_disabled");
  }
  const reasons: string[] = [];
  let score = 0;

  if (
    offer.allowedPlatforms?.length &&
    !offer.allowedPlatforms.includes(account.platform)
  ) {
    blockReasons.push("platform_not_allowed");
  }

  const explicitlyAllowed =
    !offer.allowedAccountIds?.length ||
    offer.allowedAccountIds.includes(account.id);
  if (!explicitlyAllowed) blockReasons.push("account_not_allowed");

  if (
    account.affiliateThirdPartyEnabled === false &&
    isThirdPartyOffer(offer)
  ) {
    blockReasons.push("third_party_offers_disabled");
  }

  const accountThemes = getAccountMonetizationThemes(account);
  const offerThemes = getOfferThemes(offer);
  const themeOverlap = offerThemes.filter((theme) =>
    accountThemes.includes(theme),
  );

  if (offer.allowedAccountIds?.includes(account.id)) {
    score += 35;
    reasons.push("explicit_account_allowlist");
  }

  if (themeOverlap.length > 0) {
    score += Math.min(50, themeOverlap.length * 20);
    reasons.push(`theme_overlap:${themeOverlap.join(",")}`);
  }

  // Preserve the original language for matching against the post text.
  // Canonical themes are used only for cross-language account/offer overlap.
  const postThemeHits = (offer.themes ?? []).filter((theme) =>
    textContainsTheme(post.text, theme),
  );
  if (postThemeHits.length > 0) {
    score += Math.min(20, postThemeHits.length * 10);
    reasons.push(`post_theme_match:${postThemeHits.join(",")}`);
  }

  if (offer.category && textContainsTheme(post.text, offer.category)) {
    score += 5;
    reasons.push("post_category_match");
  }

  const personaFits = (offer.personaFits ?? []).map(normalized);
  const accountPersonaTokens = [
    account.id,
    account.handle,
    account.display_name,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalized);

  if (
    personaFits.some((fit) =>
      accountPersonaTokens.some(
        (token) => token.includes(fit) || fit.includes(token),
      ),
    )
  ) {
    score += 10;
    reasons.push("persona_fit");
  }

  const hasExplicitTarget = Boolean(
    offer.allowedAccountIds?.includes(account.id),
  );
  if (
    !hasExplicitTarget &&
    offerThemes.length === 0
  ) {
    blockReasons.push("missing_target_metadata");
  } else if (
    !hasExplicitTarget &&
    offerThemes.length > 0 &&
    themeOverlap.length === 0
  ) {
    blockReasons.push("account_theme_mismatch");
  }

  if (score <= 0) blockReasons.push("no_contextual_match");

  return {
    eligible: blockReasons.length === 0,
    score,
    reasons,
    blockReasons: unique(blockReasons),
    themeOverlap,
  };
}

/**
 * Rank only pre-validated eligible offers. Rotation is scoped to one account;
 * never let a different account's replies affect this account's selection.
 *
 * An immediate repeat is heavily penalized when an alternative is eligible,
 * while the seven-day usage count provides gradual exposure balancing.
 * Eligibility, advertiser restrictions and offer cooldowns are enforced
 * before this function is called.
 */
export function rankAffiliateOffers<T extends {
  offer: Pick<AffiliateOfferRecord, "id">;
  score: number;
}>(
  candidates: T[],
  accountId: string,
  replies: Array<Pick<
    AffiliateReplyRecord,
    "account_id" | "offer_id" | "status" | "created_at"
  >>,
  now: DateTime,
): Array<T & {
  selectionScore: number;
  recent7dUses: number;
  wasLastUsed: boolean;
}> {
  const recent = replies
    .filter((reply) =>
      reply.account_id === accountId &&
      ["publishing", "pending_reconciliation", "published", "reconciled"].includes(reply.status),
    )
    .map((reply) => ({ reply, created: DateTime.fromISO(reply.created_at) }))
    .filter(({ created }) =>
      created.isValid &&
      now.diff(created, "milliseconds").milliseconds >= 0 &&
      now.diff(created, "days").days <= 7,
    )
    .sort((a, b) => b.created.toMillis() - a.created.toMillis());

  const lastOfferId = recent[0]?.reply.offer_id;
  const counts = new Map<string, number>();
  for (const item of recent) {
    counts.set(item.reply.offer_id, (counts.get(item.reply.offer_id) ?? 0) + 1);
  }

  return candidates
    .map((candidate) => {
      const recent7dUses = counts.get(candidate.offer.id) ?? 0;
      const wasLastUsed = candidate.offer.id === lastOfferId;
      const usagePenalty = Math.min(recent7dUses * 12, 84);
      const repeatPenalty = candidates.length > 1 && wasLastUsed ? 100 : 0;
      return {
        ...candidate,
        selectionScore: candidate.score - usagePenalty - repeatPenalty,
        recent7dUses,
        wasLastUsed,
      };
    })
    .sort((a, b) =>
      b.selectionScore - a.selectionScore ||
      b.score - a.score ||
      a.offer.id.localeCompare(b.offer.id),
    );
}

export function passesPromoReplyRate(
  accountId: string,
  parentPostId: string,
  rate: number,
): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const input = `${accountId}:${parentPostId}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const bucket = (hash >>> 0) / 0xffffffff;
  return bucket < rate;
}

export function isRecognizedDisclosure(value: string): boolean {
  return /(^|[\s#【［(（])(?:PR|広告|プロモーション)(?:$|[\s】］)）:：])/i.test(
    value.trim(),
  );
}

export function validateDisclosure(
  disclosure: string,
  offer: AffiliateOfferRecord,
): { ok: boolean; reason?: string } {
  const value = disclosure.trim();
  if (!value) return { ok: false, reason: "disclosure_missing" };
  if (!isRecognizedDisclosure(value)) {
    return { ok: false, reason: "disclosure_marker_missing" };
  }
  if (
    offer.disclosureText?.trim() &&
    !normalized(value).includes(normalized(offer.disclosureText))
  ) {
    return { ok: false, reason: "offer_disclosure_text_missing" };
  }
  return { ok: true };
}

export function composeAffiliateReplyText(
  text: string,
  disclosure: string,
): string {
  const body = text.trim();
  const marker = disclosure.trim();
  if (!marker) return body;
  if (normalized(body).includes(normalized(marker))) return body;
  return `${marker}\n${body}`;
}

export type AffiliateReplyPublishAction =
  | "publish"
  | "reconcile_only"
  | "already_published"
  | "blocked";

export function getAffiliateReplyPublishAction(
  status: AffiliateReplyStatus,
): AffiliateReplyPublishAction {
  if (status === "draft") return "publish";
  if (status === "publishing" || status === "pending_reconciliation") {
    return "reconcile_only";
  }
  if (status === "published" || status === "reconciled") {
    return "already_published";
  }
  return "blocked";
}

export function isReplyOccupyingParent(status: AffiliateReplyStatus): boolean {
  return status !== "failed";
}
