import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { selectPostsForPersistence } from "@/lib/services/sync-policy";
import type { AccountDoc } from "@/lib/types";
import type { SyncPostPayload } from "@/lib/platforms/types";

const account: AccountDoc = {
  id: "threads_test",
  platform: "threads",
  handle: "test",
  display_name: "Test",
  connected: true,
  scopes: [],
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  sync_cursor: "2026-08-24T12:00:00.000Z",
};

function payload(id: string, createdAt: string): SyncPostPayload {
  return {
    platform: "threads",
    platform_post_id: id,
    text: id,
    created_at: createdAt,
    media_type: "text",
    has_url: false,
    metrics: {
      impressions: 0,
      likes: 0,
      replies: 0,
      reposts_or_rethreads: 0,
    },
    raw: {},
  };
}

const now = DateTime.fromISO("2026-08-25T00:00:00.000Z");
const selected = selectPostsForPersistence(
  account,
  [
    payload("new", "2026-08-24T13:00:00.000Z"),
    payload("recent-metrics", "2026-08-24T10:00:00.000Z"),
    payload("stale", "2026-08-20T10:00:00.000Z"),
    payload("new", "2026-08-24T13:00:00.000Z"),
  ],
  now,
  48,
);

assert.deepEqual(
  selected.map((post) => post.platform_post_id),
  ["new", "recent-metrics"],
  "only new or recently published posts should be persisted, without duplicates",
);

assert.equal(
  selectPostsForPersistence(
    { ...account, sync_cursor: undefined },
    [payload("initial-a", "2026-01-01T00:00:00.000Z")],
    now,
  ).length,
  1,
  "initial sync should persist its bounded backfill",
);

console.log("Firestore efficiency tests passed (2 assertions).\n");
