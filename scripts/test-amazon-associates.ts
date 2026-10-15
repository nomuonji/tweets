import assert from "node:assert/strict";
import { hasVerifiedAmazonAssociatesTag as allowed } from "../src/lib/services/amazon-associates-policy";

const account = "threads_chinsukedt";
const url = "https://www.amazon.co.jp/dp/B008P5TPO4?tag=tweets-sns-22";
const verified = { AMAZON_ASSOCIATES_JP_VERIFIED_TAG: "tweets-sns-22" };
assert.equal(allowed(account, url, {}), false);
assert.equal(allowed(account, url, verified), true);
assert.equal(allowed("threads_date_blueprints", url, verified), true);
assert.equal(allowed(account, url, { AMAZON_ASSOCIATES_JP_VERIFIED_TAG: "another-22" }), false);
assert.equal(allowed(account, url, { AMAZON_ASSOCIATES_JP_VERIFIED_TAG: "foreign-20" }), false);
assert.equal(allowed(account, url.replace("www.amazon.co.jp", "evil.example"), verified), false);
assert.equal(allowed(account, url + "&tag=tweets-sns-22", verified), false);
assert.equal(allowed("threads_unrelated", url, {}), true);
console.log("Amazon tracking-tag configuration tests passed");
