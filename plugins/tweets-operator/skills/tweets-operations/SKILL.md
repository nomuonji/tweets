---
name: tweets-operations
description: Operate the authenticated Tweets MCP service to diagnose inventory, run the Buzz Editorial Harness, save approved current-version drafts, and manage post operations safely.
---

# Tweets operations

Use this skill when operating the configured Tweets MCP server.

Start with get_system_health, then call get_generation_work for every target account. Read the exact current character version and inventory gap. Read get_generation_brief only as downstream persona/context and source-pool support; it does not replace independent market research.

## Mandatory draft creation route

1. Build the evidence packet from actual canonical external_posts IDs:
   - 3+ independent search clusters
   - 6+ actual posts / 4+ authors
   - Top and Latest acquisition lanes
   - 30%+ blind discovery observations
   - two counterexamples including one bottom-quartile engagement example
2. Extract 3+ distinct audience-response mechanisms with ordinary reaction, attention trigger, immediate reward, social use, counterexample and long-distance transfer.
3. Generate 15+ distinct concept candidates before selecting the final drafts.
4. Run the Baka Model, Idea Resonance and Social Post Quality Gate A–G for every final text. Reject weak work instead of padding inventory.
5. Submit submit_buzz_harness_run. Only awaiting_review means the server accepted the evidence packet for the next stage; it does NOT permit saving.
6. A separate reviewer/model must read every final text without the author's rationale and call approve_buzz_harness_run with an exact PASS receipt per text hash. Reviewer identity and model must differ from the writer's declared identity/model.
7. Call create_drafts with the returned approvalHash, exact reviewed text and matching provenance. Do not edit copy after review.
8. Re-run get_generation_work / list_drafts and verify the inventory.

The server cross-checks account character versions, canonical external post records, corpus coverage, evidence age, counterexamples, divergence count, hard-gate notes, duplicate/similarity checks, exact final-copy hashes and reviewer receipts. The approval expires after 24 hours and is consumed once per account.

## Prohibited bypasses

- Do not write to Firestore drafts directly.
- Do not use legacy save_drafts.ts, saveDraft, generatePost(s) or scheduled server-generation fallbacks.
- Do not use update_draft or dashboard edit APIs to change text/hashtags after harness approval.
- Never publish arbitrary text or call publish_draft during replenishment. The existing scheduler owns publication.
- Never lower quality gates or claim that a passing desk review guarantees virality.

The reviewer identity/model values are not cryptographically authenticated by this server. State that limitation when describing the harness; do not claim an authenticated independent human reviewer.
