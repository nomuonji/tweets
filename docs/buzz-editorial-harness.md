# Buzz Editorial Harness

## Purpose

Prevent the SNS drafting process from silently skipping research, idea divergence, reader-side selection and final review. A prompt/checklist is not sufficient: the server must reject a save request without a complete evidence packet and a separate review receipt.

## Runtime sequence

get_system_health → get_generation_work → get_generation_brief → external corpus discovery → mechanism cards → 15+ concept candidates → per-copy gates → submit_buzz_harness_run → approve_buzz_harness_run → create_drafts → inventory readback.

### Stage 1 — evidence and editorial validation

The caller submits a BuzzHarnessPacketSchema packet. The server independently reads:
- Live account profile and character version.
- Current usable draft inventory.
- Referenced records in the canonical external_posts collection.
- Recent published posts and existing drafts for duplicate checks.

Hard requirements:
- 3+ distinct search clusters/keywords.
- 6+ actual posts from 4+ distinct authors.
- Both Top and Latest acquisition lanes.
- 30%+ observations from blind discovery, with at least 30% of clusters backed by canonical collector-written `discovery_origin=blind_discovery` and a matching `discovery_query_id`. A packet's `origin` field alone is never evidence.
- Actual source IDs, text, author, canonical URL, search keyword, collector query identity, publication/fetch time, acquisition lane and measured follower-relative engagement signal.
- Account-keyword and reference-account results are not blind discovery. The current account-scoped collector records those as such; until a separate blind-discovery acquisition path writes canonical blind receipts, the harness must reject the packet rather than count a caller-labelled cluster.
- At least two counterexamples, including a post in the sample's lowest engagement quartile.
- 3+ distinct response mechanisms.
- 15+ distinct candidate concepts from 3+ mechanisms.
- Live persona/inventory snapshots match.
- Every final text has Baka Model, Idea Resonance and Social Post Quality Gate A–G PASS notes.
- Statistic/research-first hooks are rejected.
- Every final text receives an exact server-side reviewer hash receipt after evidence validation; reviewer PASS is not submitted by the drafting agent.
- Existing content and within-batch similarity checks pass.

A successful submission creates a buzz_harness_runs/{runId} audit record with status awaiting_review. This is deliberately not saveable.

### Stage 2 — server-executed blind Gemini review

approve_buzz_harness_run accepts only runId and reportHash. It does not accept a caller-supplied reviewer identity, model, PASS status or review notes.

The server:
- Chooses a configured Gemini model distinct from the writer's declared model.
- Makes an actual Gemini API call. If no Gemini key/model is configured, the API is unavailable, or the response is malformed, approval fails closed.
- Sends only target-account concept/platform, objective, exact final copy and raw reference-post text. It withholds author rationale, candidate explanations, mechanism notes and author gate notes.
- Requires independent PASS/REJECT decisions and a specific note for each of seven checks: entry/understanding, specific core, reader reward, sharing/conversation reason, voice/naturalness, source transformation, and factual/rights/safety.
- Reviews every exact final-copy hash in bounded batches; missing/duplicate/changed hashes or any failed gate prevent approval.

Only a fully passing server review transitions the run to approved and produces an approvalHash. A rejection stores the result as review_rejected; it cannot be saved.

Identity limitation: the independent Gemini call is a real server-side API invocation, but the writer's declared model is not authenticated by a credential. The reviewer is selected to differ from that declaration, but do not claim cryptographic authentication of the writer identity/model.

### Stage 3 — exact-copy save

The create_drafts MCP tool requires:
- harnessRunId
- harnessApprovalHash
- Current expectedCharacterVersion
- Exact copy matching the SHA-256 hash in the approved manifest
- Matching provenance.buzzRunId, candidateId and sorted externalPostIds

The service re-reads account, inventory and the harness document inside the same Firestore transaction. It checks persona/version, approval hash, expiry, one-use-per-account consumption and exact final-copy/source mapping before creating any draft. It records consumption in the same transaction.

After review, text cannot be edited by update_draft or the dashboard API. Revisions require a new harness run. Publication remains owned by the existing scheduler.

## Bypass closure

- .github/workflows/auto-generate-drafts.yml: no longer scheduled; legacy workflow refuses generation.
- scripts/auto-generate-drafts.ts: fail-closed deprecation entry point.
- prompt-service.generatePosts/generatePost: throw instead of direct Firestore write.
- saveDraft: deprecated and throws.
- .agent/workflows/scripts/save_drafts.ts: direct Firestore writer removed; fails closed.
- POST /api/drafts: requires harness approval hash and provenance.
- MCP create_drafts: requires second-stage approval hash.
- MCP and dashboard update paths cannot change harness-approved copy/hashtags.

## Audit and test

The audit record stores:
- Packet/report hashes.
- Source-post fingerprints and evidence metrics.
- Account and character-version receipts.
- Gate results, candidate count and corpus coverage.
- Exact approved text hashes and source attribution.
- Actual Gemini reviewer model, exact reviewed hashes, seven-gate findings and notes.
- Approval hash, expiry and consumed account IDs.

npm run test:buzz-harness checks acceptance and rejection cases for evidence coverage, author diversity, reaction bands, source verification, blind review identity/model, exact-copy review, statistic-first hooks and minimum divergence. The same test is included in prebuild and the dedicated GitHub Actions workflow.

## Known limitations

- The harness validates only posts already stored in the canonical `external_posts` collection. It does not itself crawl X or authenticate that the caller read the whole source page; acquisition/sync is a separate stage. Independent Blind Discovery is implemented as a separate account-independent X search collector; it writes append-only acquisition receipts to `external_post_observations`. The Harness validates the exact receipt rather than mutable fields on `external_posts`. The collector is scheduled through GitHub Actions after merge; do not treat it as operationally verified until a successful run and receipt readback are confirmed.
- The writer's declared identity/model is not authenticated as a credential. The reviewer is an actual server-side Gemini API call.
- The minimum corpus and follower-relative engagement signal requirements can reject a run if the source pool is incomplete. The correct response is to collect evidence, not lower thresholds.
- PASS is an editorial/evidence gate, not a human panel, market experiment or prediction of virality.
