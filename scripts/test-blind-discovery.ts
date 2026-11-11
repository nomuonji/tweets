import assert from "node:assert/strict";
import {
  BLIND_DISCOVERY_SEEDS,
  buildBlindDiscoveryPlan,
  buildBlindObservationId,
  hashBlindSourceText,
} from "@/lib/blind-discovery";

function main() {
  assert.ok(BLIND_DISCOVERY_SEEDS.length >= 15);
  assert.equal(new Set(BLIND_DISCOVERY_SEEDS.map((seed) => seed.id)).size, BLIND_DISCOVERY_SEEDS.length);
  assert.equal(new Set(BLIND_DISCOVERY_SEEDS.map((seed) => seed.query)).size, BLIND_DISCOVERY_SEEDS.length);

  const first = buildBlindDiscoveryPlan(0, "2026-11-12");
  const firstAgain = buildBlindDiscoveryPlan(0, "2026-11-12");
  const second = buildBlindDiscoveryPlan(first.nextCursorIndex, "2026-11-13");
  assert.deepEqual(first, firstAgain, "A retry on the same cursor/date must resolve to the same source query.");
  assert.deepEqual(first.lanes, ["Top", "Latest"]);
  assert.notEqual(first.seed.id, second.seed.id);
  assert.match(first.queryId, /^blind:v1:/);
  assert.match(first.runId, /^blind_20261112_/);

  const topReceipt = buildBlindObservationId(first.runId, "tweet-1", "Top");
  const latestReceipt = buildBlindObservationId(first.runId, "tweet-1", "Latest");
  const nextDayReceipt = buildBlindObservationId(second.runId, "tweet-1", "Top");
  assert.notEqual(topReceipt, latestReceipt, "The two acquisition lanes require separate immutable receipts.");
  assert.notEqual(topReceipt, nextDayReceipt, "A later search run must append a new observation, not overwrite the old one.");
  assert.equal(topReceipt, buildBlindObservationId(first.runId, "tweet-1", "Top"));
  assert.notEqual(hashBlindSourceText("same source"), hashBlindSourceText("changed source"));

  assert.throws(() => buildBlindDiscoveryPlan(-1, "2026-11-12"));
  assert.throws(() => buildBlindDiscoveryPlan(0, "not-a-date"));

  console.log(`Blind Discovery planner tests passed (${BLIND_DISCOVERY_SEEDS.length} independent seeds).`);
}

main();
