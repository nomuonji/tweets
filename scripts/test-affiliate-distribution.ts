import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  composeAffiliateReplyText,
  getAffiliateReplyPublishAction,
  isReplyOccupyingParent,
  matchAffiliateOffer,
  passesPromoReplyRate,
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
  const good = matchAffiliateOffer(account(), post(), offer(), now);
  assert.equal(good.eligible, true);
  assert.ok(good.score > 0);
  assert.ok(good.themeOverlap.includes("career"));

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

  const sampleGate = passesPromoReplyRate("account", "post", 0.35);
  assert.equal(sampleGate, passesPromoReplyRate("account", "post", 0.35));
  assert.equal(passesPromoReplyRate("account", "post", 0), false);
  assert.equal(passesPromoReplyRate("account", "post", 1), true);

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
