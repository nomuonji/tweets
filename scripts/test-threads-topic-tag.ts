import assert from "node:assert/strict";
import { normalizeThreadsTopicTag } from "@/lib/threads-topic-tag";

assert.equal(normalizeThreadsTopicTag("  #日本語の話題  "), "日本語の話題");
assert.equal(normalizeThreadsTopicTag("AI tools"), "AI tools");
assert.equal(normalizeThreadsTopicTag(""), undefined);
assert.equal(normalizeThreadsTopicTag("   "), undefined);
assert.equal(normalizeThreadsTopicTag("AI.tools"), undefined);
assert.equal(normalizeThreadsTopicTag("AI & tools"), undefined);
assert.equal(normalizeThreadsTopicTag("a".repeat(51)), undefined);
assert.equal(normalizeThreadsTopicTag("a".repeat(50)), "a".repeat(50));
assert.equal(normalizeThreadsTopicTag("#123"), undefined);
assert.equal(normalizeThreadsTopicTag(null), undefined);
assert.equal(normalizeThreadsTopicTag(123), undefined);

console.log("Threads topic-tag tests passed.");
