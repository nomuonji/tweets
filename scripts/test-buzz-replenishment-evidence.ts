import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { selectResearchEvidence, verifyEvidenceSources } from "@/lib/buzz-replenishment-evidence";
import type { ExternalPostDoc, ExternalPostObservationDoc } from "@/lib/types";

const now = Date.parse("2026-11-16T06:00:00.000Z");
const date = new Date(now - 3_600_000).toISOString();
const posts = new Map<string, ExternalPostDoc>();
const receipts: ExternalPostObservationDoc[] = [];
const hash = (x: string) => createHash("sha256").update(x).digest("hex");

for (let cluster = 0; cluster < 5; cluster += 1) {
  for (let p = 0; p < 3; p += 1) {
    const blind = cluster < 3;
    const id = `post_${cluster}_${p}`;
    const text = `Public source ${cluster} / ${p}: a nontrivial concrete observation with factual detail.`;
    const mode = p === 0 ? "Top" : "Latest";
    const query = `theme_${cluster}`;
    const queryId = `query_${cluster}_collection`;
    const author = `author_${cluster}_${p}`;
    const url = `https://x.com/${author}/status/${cluster}${p}`;
    const post: ExternalPostDoc = {
      id, platform: "x", platform_post_id: `${cluster}${p}`,
      text, author_handle: author, created_at: date, fetched_at: date, url,
      metrics: { impressions: 1000, likes: p * 20, replies: 1, reposts_or_rethreads: 3 },
      engagement_rate: 0.005 + 0.01 * (cluster * 3 + p),
      search_keyword: query, discovery_origin: blind ? "blind_discovery" : "account_keyword",
      discovery_query_id: queryId, discovery_mode: mode,
    };
    posts.set(id, post);
    receipts.push({
      id: `receipt_${id}`, external_post_id: id, platform: "x",
      platform_post_id: post.platform_post_id, author_handle: author,
      canonical_url: url, text_hash: hash(text), created_at: date, fetched_at: date,
      search_keyword: query, discovery_query_id: queryId,
      discovery_origin: blind ? "blind_discovery" : "account_keyword",
      discovery_mode: mode, source_type: blind ? "account_independent_query" : "account_keyword_query",
      collector_version: blind ? "blind-discovery-v1" : "external-discovery-v2",
      run_id: `run_${cluster}`, metrics: post.metrics,
      ...(!blind ? { target_account_id: cluster === 3 ? "account-a" : "account-b" } : {}),
    });
  }
}

function main() {
  const baseline = verifyEvidenceSources(receipts, posts, now);
  assert.equal(baseline.verified.length, 15, "all real immutable receipts must match their public source");
  const selected = selectResearchEvidence(baseline.verified);
  assert.equal(selected.reason, undefined);
  assert.equal(selected.clusters.length, 5);
  assert.equal(selected.sources.length, 15);
  assert.ok(selected.metrics.blindObservations / selected.sources.length >= 0.3);
  assert.ok(selected.metrics.blindClusters / selected.clusters.length >= 0.3);
  assert.ok(selected.metrics.lowReactionIds.length >= 2);
  assert.ok(selected.metrics.highReactionIds.length >= 2);
  assert.ok(selected.metrics.top > 0 && selected.metrics.latest > 0);
  assert.equal(new Set(selected.sources.map(x => x.post.id)).size, selected.sources.length);

  // Valid receipts that contain only a tracking URL have no usable
  // topical text. They must not satisfy the writer's six-observation gate.
  const linkOnly = baseline.verified.map(x => x.post.id === "post_3_1"
    ? { ...x, post: { ...x.post, text: "https://t.co/example" } }
    : x);
  const withoutLink = selectResearchEvidence(linkOnly, 15, "account-a");
  assert.ok(!withoutLink.sources.some(x => x.post.id === "post_3_1"),
    "pure link text must not count as a usable writer observation");
  const allLinks = selectResearchEvidence(baseline.verified.map(x => ({
    ...x, post: { ...x.post, text: "https://t.co/example" },
  })));
  assert.equal(allLinks.sources.length, 0);
  assert.match(allLinks.reason ?? "", /fewer than six verified posts/);

  // Regression: both accounts share independent mechanisms, never each other's
  // account-keyword evidence. The old global selection supplied identical work.
  const a = selectResearchEvidence(baseline.verified, 15, "account-a");
  const b = selectResearchEvidence(baseline.verified, 15, "account-b");
  assert.equal(a.reason, undefined);
  assert.equal(b.reason, undefined);
  assert.ok(a.sources.some(x => x.receipt.target_account_id === "account-a"));
  assert.ok(a.metrics.targetKeywordObservations > 0);
  assert.ok(b.metrics.targetKeywordObservations > 0);
  assert.ok(b.sources.some(x => x.receipt.target_account_id === "account-b"));
  assert.ok(a.sources.every(x => x.receipt.discovery_origin === "blind_discovery" || x.receipt.target_account_id === "account-a"));
  assert.ok(b.sources.every(x => x.receipt.discovery_origin === "blind_discovery" || x.receipt.target_account_id === "account-b"));
  assert.notDeepEqual(a.sources.map(x => x.post.id), b.sources.map(x => x.post.id));
  const withoutKeywords = selectResearchEvidence(baseline.verified, 15, "discovery-disabled");
  assert.match(withoutKeywords.reason ?? "", /no verified account-specific keyword sources/);
  assert.equal(withoutKeywords.metrics.targetKeywordObservations, 0);
  // Explicitly opted-out accounts may still learn generic mechanisms,
  // provided the editorial worker independently verifies topic facts.
  const optedOut = selectResearchEvidence(baseline.verified, 15, "discovery-disabled", {
    requireAccountKeywordEvidence: false,
  });
  assert.equal(optedOut.reason, undefined);
  assert.equal(optedOut.metrics.targetKeywordObservations, 0);
  assert.ok(withoutKeywords.sources.every(x => x.receipt.discovery_origin === "blind_discovery"));

  // Reproduce the live failure: a high-engagement unrelated post and an
  // explicit ad were previously selected ahead of relevant dating observations.
  const template = baseline.verified.find(x => x.post.id === "post_3_0")!;
  const fixture = (id: string, text: string, rate: number, mode: "Top" | "Latest") => ({
    post: { ...template.post, id, text, engagement_rate: rate, author_handle: id },
    receipt: { ...template.receipt, search_keyword: "デート 財布 会計", discovery_mode: mode },
  });
  const topical = selectResearchEvidence([
    ...baseline.verified.filter(x => x.receipt.discovery_origin === "blind_discovery"),
    fixture("unrelated", "簿記の会計処理について", 0.9, "Top"),
    fixture("advertisement", "【広告】デートの財布と会計はこちら", 0.8, "Top"),
    fixture("relevant-top", "デートの会計で財布を出すタイミングが難しい", 0.1, "Top"),
    fixture("relevant-latest", "デートの会計が終わるまで財布をしまったまま", 0.05, "Latest"),
    fixture("relevant-low", "デートの会計は財布を出す前に話し合いたい", 0.01, "Latest"),
  ], 15, "account-a");
  assert.equal(topical.reason, undefined);
  assert.ok(topical.sources.some(x => x.post.id === "relevant-top"));
  assert.ok(topical.sources.some(x => x.post.id === "relevant-latest"));
  assert.ok(topical.sources.some(x => x.post.id === "relevant-low"));
  assert.ok(!topical.sources.some(x => ["unrelated", "advertisement"].includes(x.post.id)));
  const duplicate = selectResearchEvidence([
    ...baseline.verified,
    fixture("copy-1", "デートの会計で財布を出すタイミング", 0.2, "Top"),
    fixture("copy-2", "デートの会計で財布を出すタイミング！", 0.1, "Latest"),
  ], 15, "account-a");
  assert.ok(duplicate.sources.filter(x => ["copy-1", "copy-2"].includes(x.post.id)).length <= 1);

  const altered = receipts.map(x => ({ ...x }));
  altered[0].text_hash = "forged";
  const mismatched = verifyEvidenceSources(altered, posts, now);
  assert.equal(mismatched.rejected.identity_or_text_hash_mismatch, 1,
    "tampering with immutable source text hash must invalidate evidence");
  assert.equal(mismatched.verified.length, 14);

  const missingRate = new Map(posts);
  missingRate.set("post_0_1", { ...posts.get("post_0_1")!, engagement_rate: null });
  const checked = verifyEvidenceSources(receipts, missingRate, now);
  assert.equal(checked.rejected.missing_measured_engagement, 1,
    "unmeasured reactions must not be invented to meet the market gate");

  const fakeBlind = receipts.map(x => ({ ...x }));
  fakeBlind[14].discovery_origin = "blind_discovery";
  const unverified = verifyEvidenceSources(fakeBlind, posts, now);
  assert.equal(unverified.rejected.unverified_blind_origin, 1,
    "account-keyword receipts cannot be relabeled as independent research");

  const blindOnly = baseline.verified.filter(x => x.receipt.discovery_origin === "blind_discovery");
  const validBlindOnly = selectResearchEvidence(blindOnly);
  assert.equal(validBlindOnly.reason, undefined, "independent-only corpora can legitimately pass");
  const notEnough = selectResearchEvidence(baseline.verified.slice(0, 2));
  assert.ok(notEnough.reason, "a sparse corpus must fail before ideation, without bypassing the Harness");

  console.log("Replenishment evidence integrity, balanced selection and failure gates passed.");
}
main();
