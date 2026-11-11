---
description: Buzz Editorial Harness — evidence-bound Threads/X drafting
---

# Buzz Editorial Harness

Do not create or save posts by following this document as a checklist alone. The Tweets Operator server validates the evidence packet against its canonical Firestore records and blocks draft writes unless both stages complete.

## Non-negotiable order

1. Read get_system_health and get_generation_work for each target account. Record the current character version and exact inventory gap.
2. Read get_generation_brief for account voice, relevant examples and source IDs. This is not market evidence by itself.
3. Conduct independent external discovery before reading the account's past posts as idea seeds:
   - At least 3 distinct search clusters / queries.
   - At least 6 actual public posts from at least 4 distinct authors.
   - Include Top and Latest acquisition lanes.
   - At least 30% of observations must come from blind discovery beyond the initial seed.
   - Preserve original post IDs, authors, text, URLs, search keyword, discovery lane, published/fetched timestamps and measured engagement fields in canonical external_posts.
   - Include at least two counterexamples; one must be in the lowest quartile of the observed follower-relative engagement sample.
   - If required source records or metrics do not exist, stop. Do not substitute summaries, guessed metrics, press releases or invented references.
4. Extract at least 3 distinct response mechanisms. Each must state the ordinary response, audience situation, attention trigger, immediate reward, social use, counterexample, transfer mechanism and at least two distant transfer contexts.
5. Diverge at least 15 meaningfully different candidate concepts across at least 3 mechanisms. Each candidate must specify ordinary baseline → one meaningful shift → familiar format return, an audience moment, immediate reward, share reason and source post IDs.
6. Write the final text. Run the Baka Model and Idea Resonance gates for every post. Then run all Social Post Quality Gate A–G checks. Keep the actual reason for each PASS, not a repeated generic phrase. Reject statistics/research-first hooks unless the reader's immediate reward is the number itself and no methodological explanation is needed.
7. Prepare each final copy for blind review. Never include author rationale, intended effect, candidate mechanism or gate notes in the review payload. The server constructs the reviewer payload from exact final copy, neutral account context and raw reference text.
8. Submit the complete JSON packet to submit_buzz_harness_run.
   - rejected means no save permission. Fix the evidence or the copy, create a new run ID, and submit a new packet.
   - awaiting_review means the packet passed server validation but is still NOT saveable. It returns runId and reportHash.
9. Call approve_buzz_harness_run with only runId/reportHash. The server invokes a configured Gemini model, chosen distinct from the writer's declared model, to review every exact final copy against seven independent gates. No caller-supplied reviewer ID/model or PASS receipt is accepted. Gemini failure, invalid JSON or any rejected gate means no approvalHash and no save.
10. Call create_drafts with the exact reviewed text, its current character version, harnessRunId, harnessApprovalHash, and matching provenance (buzzRunId, candidateId, externalPostIds). Do not rephrase after review.
11. Re-run get_generation_work and list_drafts to verify the saved inventory. The existing publishing scheduler remains the only publication path. Never call publish_draft as part of replenishment.

## Hard stops

- No direct Firestore writes to drafts, including My Firebase, scripts or generic helpers.
- No save_drafts.ts legacy script, server-side prompt-generation fallback or scheduled auto-generation route.
- No self-review; reviewer identity and model must differ from the writer's declared identity/model.
- No reuse of a candidate, evidence post outside the captured corpus, stale persona version, stale inventory receipt or expired run.
- No edits to harness-approved text/hashtags. Re-run the full process to change the copy.
- No lowering corpus, mechanism, candidate or gate thresholds just to fill the queue.
- No claim that PASS predicts virality. It is an editorial/evidence gate, not an experiment.

The server-side Gemini review is an actual API invocation, but the writer's declared identity/model is not cryptographically authenticated. Do not claim an independently authenticated writer identity.
