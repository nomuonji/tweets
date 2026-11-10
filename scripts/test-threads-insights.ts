import assert from "node:assert/strict";
import { parseThreadsPostInsights } from "@/lib/platforms/threads";
import { resolveThreadsOAuthScopes } from "@/lib/oauth/threads-scopes";

const parsed = parseThreadsPostInsights({
  data: [
    { name: "views", period: "lifetime", values: [{ value: 842 }], title: "Views", description: "", id: "views" },
    { name: "likes", period: "lifetime", values: [{ value: 31 }], title: "Likes", description: "", id: "likes" },
    { name: "replies", period: "lifetime", values: [{ value: 4 }], title: "Replies", description: "", id: "replies" },
    { name: "reposts", period: "lifetime", values: [{ value: 2 }], title: "Reposts", description: "", id: "reposts" },
    { name: "quotes", period: "lifetime", values: [{ value: 1 }], title: "Quotes", description: "", id: "quotes" },
  ],
});
assert.deepEqual(parsed, {
  impressions: 842,
  likes: 31,
  replies: 4,
  reposts_or_rethreads: 2,
  quotes: 1,
  link_clicks: null,
});

const missingViews = parseThreadsPostInsights({
  data: [
    { name: "likes", period: "lifetime", values: [{ value: 7 }], title: "Likes", description: "", id: "likes" },
  ],
});
assert.equal(missingViews.impressions, null, "unavailable Views must remain null, not zero");
assert.equal(missingViews.likes, 7);

assert.deepEqual(
  resolveThreadsOAuthScopes("threads_basic,threads_keyword_search threads_content_publish"),
  ["threads_basic", "threads_keyword_search", "threads_content_publish", "threads_manage_insights"],
);
assert.deepEqual(resolveThreadsOAuthScopes(""), [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
]);

console.log("Threads Insights parsing and OAuth scope tests passed.");
