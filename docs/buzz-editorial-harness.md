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
- 30%+ observations from blind discovery.
- Actual source IDs, text, author, canonical URL, search keyword, publication/fetch time, acquisition lane and measured follower-relative engagement signal.
- At least two counterexamples, including a post in the sample's lowest engagement quartile.
- 3+ distinct response mechanisms.
- 15+ distinct candidate concepts from 3+ mechanisms.
- Live persona/inventory snapshots match.
- Every final text has Baka Model, Idea Resonance and Social Post Quality Gate A–G PASS notes.
- Statistic/research-first hooks are rejected.
- Every final text has a different declared initial reviewer identity from the writer, exact reviewed-text hash and current review time.
- Existing content and within-batch similarity checks pass.

A successful submission creates a buzz_harness_runs/{runId} audit record with status awaiting_review. This is deliberately not saveable.

### Stage 2 — separate blind reviewer approval

approve_buzz_harness_run requires:
- A reviewer ID different from the writer ID.
- A reviewer model different from the writer model.
- blind_copy_only mode (the reviewer does not receive the author's rationale).
- An exact PASS receipt for every final text SHA-256 hash in the pending run.
- A substantive note and recent timestamp for each reviewed copy.

The server stores the reviewer receipt and transitions the run to approved, returning an approvalHash. A missing, duplicate, failed or mismatched text hash blocks approval.

Identity limitation: reviewer ID and model are supplied by the caller and compared against the writer declaration; they are not authenticated by a separate OAuth identity or cryptographic signature. The tool enforces a second declared reviewer stage, not independently authenticated human identity. Never describe it as cryptographically verified.

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
- Reviewer identity/model assertion, exact reviewed hashes and notes.
- Approval hash, expiry and consumed account IDs.

npm run test:buzz-harness checks acceptance and rejection cases for evidence coverage, author diversity, reaction bands, source verification, blind review identity/model, exact-copy review, statistic-first hooks and minimum divergence. The same test is included in prebuild and the dedicated GitHub Actions workflow.

## Known limitations

- The harness validates only posts already stored in the canonical external_posts collection. It does not itself crawl X or authenticate that the caller read the whole source page; acquisition/sync is a separate stage.
- The reviewer identity/model are declared values, not authenticated credentials.
- The minimum corpus and follower-relative engagement signal requirements can reject a run if the source pool is incomplete. The correct response is to collect evidence, not lower thresholds.
- PASS is an editorial/evidence gate, not a human panel, market experiment or prediction of virality.
