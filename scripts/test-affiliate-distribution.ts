import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  allowsAffiliateOfferReply,
  allowsAmazonPromoReply,
  composeAffiliateReplyText,
  getAffiliateReplyPublishAction,
  isReplyOccupyingParent,
  matchAffiliateOffer,
  rankAffiliateOffers,
  getAffiliateParentGateReasons,
  resolvePromoReplyMode,
  validateDisclosure,
  type AffiliateOfferRecord,
} from "@/lib/affiliate-distribution-policy";
import type { AccountDoc, PostDoc } from "@/lib/types";

const now = DateTime.fromISO("2026-09-20T12:00:00.000Z");

function account(overrides: Partial<AccountDoc & {
  monetizationThemes: string[];
  affiliateThirdPartyEnabled: boolean;
}> = {}): AccountDoc & {
  monetizationThemes: string[];
  affiliateThirdPartyEnabled: boolean;
} {
  return {
    id: "threads_date_blueprints",
    platform: "threads",
    handle: "date_blueprints",
    display_name: "凪",
    connected: true,
    scopes: [],
    promoEnabled: true,
    promoReplyEnabled: true,
    promoReplyMode: "affiliate_offer",
    promoRate: 1,
    promoReplyMinScore: 1000,
    promoReplyMinImpressions: 1000,
    promoReplyLookbackDays: 3,
    monetizationThemes: ["career", "mobile", "internet"],
    affiliateThirdPartyEnabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function post(overrides: Partial<PostDoc> = {}): PostDoc {
  return {
    id: "threads_parent",
    account_id: "threads_date_blueprints",
    platform: "threads",
    platform_post_id: "parent",
    text: "転職するなら残業時間と年収、どっちを優先する？",
    created_at: "2026-09-20T10:00:00.000Z",
    media_type: "text",
    has_url: false,
    metrics: {
      impressions: 5000,
      likes: 100,
      replies: 10,
      reposts_or_rethreads: 5,
      quotes: 0,
      link_clicks: null,
    },
    score: 5000,
    fetched_at: "2026-09-20T11:00:00.000Z",
    ...overrides,
  };
}

function offer(overrides: Partial<AffiliateOfferRecord> = {}): AffiliateOfferRecord {
  return {
    id: "offer-career",
    kind: "lead",
    network: "a8",
    advertiser: "example",
    title: "20代向け転職相談",
    affiliateUrl: "https://example.com/affiliate",
    category: "career",
    themes: ["career", "20s"],
    conversionAction: "free_registration",
    status: "active",
    allowedPlatforms: ["threads"],
    disclosureText: "PR",
    revision: 1,
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

async function main() {

  assert.equal(resolvePromoReplyMode({}), "amazon");
  assert.equal(allowsAmazonPromoReply({}), true);
  assert.equal(allowsAffiliateOfferReply({}), false);
  assert.equal(allowsAmazonPromoReply({ promoReplyMode: "off" }), false);
  assert.equal(allowsAffiliateOfferReply({ promoReplyMode: "off" }), false);
  assert.equal(allowsAmazonPromoReply({ promoReplyMode: "affiliate_offer" }), false);
  assert.equal(allowsAffiliateOfferReply({ promoReplyMode: "affiliate_offer" }), true);
  assert.equal(allowsAmazonPromoReply({ promoReplyMode: "mixed" }), true);
  assert.equal(allowsAffiliateOfferReply({ promoReplyMode: "mixed" }), true);

  const amazonModeBlocksOffer = matchAffiliateOffer(
    account({ promoReplyMode: "amazon" }),
    post(),
    offer(),
    now,
  );
  assert.equal(amazonModeBlocksOffer.eligible, false);
  assert.ok(amazonModeBlocksOffer.blockReasons.includes("affiliate_offer_mode_disabled"));

  const good = matchAffiliateOffer(account(), post(), offer(), now);
  assert.equal(good.eligible, true);
  assert.ok(good.score > 0);
  assert.ok(good.themeOverlap.includes("career"));

  // A Ken LP offer needs a literal match to the parent's topic, not just
  // account-level permission. Legacy Kanna offers remain unchanged.
  const ken = account({
    id: "threads_plansetting",
    monetizationThemes: ["career", "self_investment", "saving"],
  });
  const kenOffer = offer({
    id: "ken-onsuku",
    allowedAccountIds: [ken.id],
    themes: ["self_investment", "自己投資", "資格", "勉強"],
    requirePostThemeMatch: true,
  });
  const unrelatedPost = post({
    account_id: ken.id,
    text: "20代の俺が疲れないようにしている生活のルール。睡眠7時間、湯船を週4回。",
  });
  const unrelated = matchAffiliateOffer(ken, unrelatedPost, kenOffer, now);
  assert.equal(unrelated.eligible, false);
  assert.ok(unrelated.blockReasons.includes("post_theme_mismatch"));
  assert.ok(unrelated.score > 0, "account allowlist alone must not bypass relevance");
  const relevant = matchAffiliateOffer(ken, post({
    account_id: ken.id,
    text: "20代の自己投資でやってよかったこと。資格の勉強は少しずつ。",
  }), kenOffer, now);
  assert.equal(relevant.eligible, true);
  assert.ok(relevant.reasons.some((reason) => reason.includes("post_theme_match")));
  const otherAccountOffer = offer({
    id: "legacy-offer",
    allowedAccountIds: [ken.id],
    themes: ["study"],
  });
  assert.equal(matchAffiliateOffer(ken, unrelatedPost, otherAccountOffer, now).eligible, true,
    "unchanged unflagged offers preserve legacy eligibility");

  // Kanna's account themes are in English, but the four approved
  // distribution records have Japanese offer themes.
  const kanna = account({
    id: "threads_uwaki_neko_xx",
    handle: "kanna_neko_xx",
    monetizationThemes: ["relationship", "love", "fidelity", "consultation", "fortune_telling"],
  });
  const kannaPost = post({
    account_id: kanna.id,
    text: "恋人の浮気を知ったら、信頼は元に戻るのかな？",
  });
  const phone = offer({
    id: "phone",
    allowedAccountIds: [kanna.id],
    themes: ["占い", "恋愛", "復縁", "不倫相談"],
  });
  const chat = offer({
    id: "chat",
    allowedAccountIds: [kanna.id],
    themes: ["占い", "恋愛相談", "チャット相談", "悩み相談"],
  });
  const phoneMatch = matchAffiliateOffer(kanna, kannaPost, phone, now);
  const chatMatch = matchAffiliateOffer(kanna, kannaPost, chat, now);
  assert.equal(phoneMatch.eligible, true);
  assert.equal(chatMatch.eligible, true);
  assert.ok(phoneMatch.themeOverlap.includes("relationship"));
  assert.ok(phoneMatch.themeOverlap.includes("fortune_telling"));
  assert.ok(phoneMatch.themeOverlap.includes("fidelity"));
  assert.ok(chatMatch.themeOverlap.includes("consultation"));

  const candidates = [
    { offer: phone, score: phoneMatch.score },
    { offer: chat, score: chatMatch.score },
  ];
  const tenPhoneReplies = Array.from({ length: 10 }, (_, index) => ({
    account_id: kanna.id,
    offer_id: phone.id,
    status: "published" as const,
    created_at: now.minus({ hours: index + 1 }).toISO()!,
  }));
  const rotated = rankAffiliateOffers(candidates, kanna.id, tenPhoneReplies, now);
  assert.equal(rotated[0].offer.id, chat.id, "ten repeated phone replies must not beat an eligible alternative");
  assert.equal(rotated.find((item) => item.offer.id === phone.id)?.recent7dUses, 10);
  assert.equal(rotated.find((item) => item.offer.id === phone.id)?.wasLastUsed, true);

  const otherAccount = [{
    ...tenPhoneReplies[0],
    account_id: "threads_another_account",
  }];
  assert.deepEqual(
    rankAffiliateOffers(candidates, kanna.id, otherAccount, now).map((item) => item.offer.id),
    rankAffiliateOffers(candidates, kanna.id, [], now).map((item) => item.offer.id),
    "a different account's replies must not affect Kanna's ranking",
  );
  assert.equal(
    rankAffiliateOffers(candidates, kanna.id, [
      { ...tenPhoneReplies[0], status: "failed" },
      { ...tenPhoneReplies[0], created_at: now.minus({ days: 8 }).toISO()! },
    ], now).find((item) => item.offer.id === phone.id)?.recent7dUses,
    0,
    "failed and old replies must not distort seven-day exposure",
  );
  assert.equal(
    rankAffiliateOffers([candidates[0]], kanna.id, tenPhoneReplies, now)[0].offer.id,
    phone.id,
    "rotation must not disable the only valid available offer",
  );

  for (const status of ["candidate", "pending_approval", "approved", "paused", "archived"] as const) {
    const result = matchAffiliateOffer(account(), post(), offer({ status }), now);
    assert.equal(result.eligible, false);
    assert.ok(result.blockReasons.includes(`offer_status_${status}`));
  }

  const expired = matchAffiliateOffer(
    account(),
    post(),
    offer({ validUntil: "2026-09-20T11:59:59.000Z" }),
    now,
  );
  assert.equal(expired.eligible, false);
  assert.ok(expired.blockReasons.includes("offer_expired"));

  const mismatch = matchAffiliateOffer(
    account({ monetizationThemes: ["relationship"] }),
    post({ text: "恋人との連絡頻度ってどのくらい？" }),
    offer({ themes: ["career"], allowedAccountIds: undefined }),
    now,
  );
  assert.equal(mismatch.eligible, false);
  assert.ok(mismatch.blockReasons.includes("account_theme_mismatch"));

  const ownedOnly = matchAffiliateOffer(
    account({ affiliateThirdPartyEnabled: false }),
    post(),
    offer({ kind: "lead" }),
    now,
  );
  assert.equal(ownedOnly.eligible, false);
  assert.ok(ownedOnly.blockReasons.includes("third_party_offers_disabled"));

  const ownedAllowed = matchAffiliateOffer(
    account({
      affiliateThirdPartyEnabled: false,
      monetizationThemes: ["english"],
    }),
    post({ text: "英文解釈で詰まりやすい文だけまとめたい" }),
    offer({
      kind: "owned_product",
      network: "owned",
      themes: ["english"],
      affiliateUrl: "https://example.com/kindle",
    }),
    now,
  );
  assert.equal(ownedAllowed.eligible, true);

  assert.equal(validateDisclosure("", offer()).ok, false);
  assert.equal(validateDisclosure("おすすめ", offer()).ok, false);
  assert.equal(validateDisclosure("PR", offer()).ok, true);
  assert.equal(
    composeAffiliateReplyText(
      "詳しくはこちら https://example.com/affiliate",
      "PR",
    ),
    "PR\n詳しくはこちら https://example.com/affiliate",
  );

  // No sampling: historical zero-valued fields may exist in Firestore,
  // but every qualifying parent post remains eligible for reply evaluation.
  const legacyZeroRate = account({ promoRate: 0 });
  Object.assign(legacyZeroRate, { promoReplyRate: 0 });
  assert.deepEqual(
    getAffiliateParentGateReasons(legacyZeroRate, post(), now),
    [],
    "zero legacy promo rates must not suppress qualified affiliate replies",
  );
  assert.deepEqual(
    getAffiliateParentGateReasons(account({ promoRate: 1 }), post(), now),
    [],
    "high-quality posts are considered without an arbitrary chance gate",
  );
  assert.ok(
    getAffiliateParentGateReasons(account(), post({ score: 999 }), now).includes("below_min_score"),
    "score threshold remains enforced",
  );
  assert.ok(
    getAffiliateParentGateReasons(
      account(),
      post({ metrics: { ...post().metrics, impressions: 999 } }),
      now,
    ).includes("below_min_impressions"),
    "impression threshold remains enforced",
  );
  assert.ok(
    getAffiliateParentGateReasons(
      account({ promoReplyEnabled: false }),
      post(),
      now,
    ).includes("promo_reply_disabled"),
    "master enable gate remains enforced",
  );
  assert.ok(
    getAffiliateParentGateReasons(
      account({ promoReplyMode: "amazon" }),
      post(),
      now,
    ).includes("affiliate_offer_mode_disabled"),
    "commerce source mode remains enforced",
  );
  assert.ok(
    getAffiliateParentGateReasons(
      account(),
      post({ created_at: now.minus({ days: 5 }).toISO()! }),
      now,
    ).includes("outside_lookback"),
    "lookback gate remains enforced",
  );

  assert.equal(getAffiliateReplyPublishAction("draft"), "publish");
  assert.equal(
    getAffiliateReplyPublishAction("publishing"),
    "reconcile_only",
  );
  assert.equal(
    getAffiliateReplyPublishAction("pending_reconciliation"),
    "reconcile_only",
  );
  assert.equal(
    getAffiliateReplyPublishAction("published"),
    "already_published",
  );
  assert.equal(getAffiliateReplyPublishAction("failed"), "blocked");
  assert.equal(isReplyOccupyingParent("draft"), true);
  assert.equal(isReplyOccupyingParent("publishing"), true);
  assert.equal(isReplyOccupyingParent("pending_reconciliation"), true);
  assert.equal(isReplyOccupyingParent("published"), true);
  assert.equal(isReplyOccupyingParent("failed"), false);

  // This is the key anti-duplication invariant: once a platform side effect may
  // have happened, the next action is reconciliation, never another publish.
  const statusAfterExternalSuccessButPersistenceFailure = "publishing" as const;
  assert.equal(
    getAffiliateReplyPublishAction(
      statusAfterExternalSuccessButPersistenceFailure,
    ),
    "reconcile_only",
  );

  console.log("Affiliate distribution policy tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
