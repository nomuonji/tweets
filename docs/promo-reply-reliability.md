# Promo reply reliability requirements

## Purpose

Attach up to two product replies to the strongest eligible posts without
duplicating replies, overwhelming an AI provider during an outage, or reporting
a partially failed monetization run as successful.

## Non-goals

- Circumventing provider quotas with uncontrolled key creation.
- Publishing low-quality deterministic copy when every generation provider is unavailable.
- Treating unrelated account-fetch warnings as monetization failures.

## Acceptance criteria

- The unnumbered Gemini key and every configured numbered key are deduplicated and available to rotation.
- A Gemini quota outage tries each configured key at most once for that request.
- A Gemini capacity outage performs three retries (four attempts total) with exponential backoff, then stops promo generation for that account in the current sync.
- Gemini quota/capacity failures are run-level events: they never increment a post's failure count or delay that post's eligibility in the next sync.
- Invalid Gemini output is regenerated up to three times before it becomes a post-specific generation failure.
- Each account performs at most two promo generation/publish attempts per sync and posts at most two replies.
- Only successfully published replies count as duplicates or start the account cooldown.
- Post-specific generation/publish failures wait three hours before retrying and stop after three failures for the same post.
- A transient Threads container-creation 400/429/5xx is retried once before the post is marked failed.
- Threads failures record the operation, HTTP status, and Meta response body instead of Axios's generic message.
- The final publish call is never automatically retried because an ambiguous response could create a duplicate visible reply.
- GitHub Actions adds an account-by-account summary and exits non-zero when a promo attempt fails.
- Legacy successful reply records without an explicit status remain valid.
- Production builds do not execute the live schedule endpoint or spend Firestore read quota.

## Current status

- ✅ Key discovery and deduplication
- ✅ Quota/capacity classification and bounded failover
- ✅ Provider outages excluded from current and legacy post failure history
- ✅ Per-account attempt and post caps
- ✅ Success-only duplicate and cooldown policy
- ✅ Failure backoff and bounded retries
- ✅ Safe Threads container retry and detailed API diagnostics
- ✅ GitHub Actions summary and monetization failure status
- ✅ Build-time Firestore schedule reads disabled
- ✅ Automated policy/failover regression test
- ✅ Targeted live Threads publish verified locally with a persisted Firebase success record
- ◐ Scheduled GitHub Actions verification requires a post-push workflow run
