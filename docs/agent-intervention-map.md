# Tweets Operator — Agent Intervention Map

## 1. Runtime map

The system has two separate generation routes. Do not confuse them.

| Stage | Runtime component | Agent intervention | Output / boundary |
|---|---|---|---|
| Collect own posts and metrics | Scheduled sync and platform APIs | None; deterministic collection. | Own posts, latest metrics and fixed-age snapshots. |
| Collect outside examples | syncExternalDiscovery | None during retrieval. Keyword queries alternate Top / Latest within the existing cache window; reference-account timelines are a separate input. | Each external result retains its search keyword and acquisition lane. This is raw research material, not approved inspiration. |
| Decide what is relevant | Editorial agent after get_generation_brief | First editorial intervention: compare the actual text with the account character sheet, intended reader and subject. Reject off-topic results even when metrics are high. | Curated source IDs and a content plan; no public post or account settings are changed. |
| Plan and write a batch | Same agent using get_generation_brief, then create_drafts | Choose distinct subjects, structures and openings. For Threads, choose one directly relevant topicTag per draft or omit it. Record provenance. | Saved drafts only. The service validates character version, inventory, platform length, duplicates/similarity and topic-tag format. |
| Final quality gate | Agent before create_drafts, plus deterministic draft validation | Check character fit, factual support, topical relevance, repetition, readability and whether the post gives readers a reason to react. | Invalid or duplicate drafts are rejected; the agent must revise rather than bypass validation. |
| Publish | scheduler-service and scheduled GitHub Actions | No creative agent at publish time. The scheduler selects an eligible saved draft and publishes it at its scheduled slot. It sends topic_tag to Threads when present. | Public post. Draft replenishment agents must not publish arbitrary text or call publish_draft. |
| Learn | Sync checkpoints and analyze-patterns.ts | Fixed-age counts and medians are calculated by the analytics job. The next generation agent reads the measured results through its next brief. | Threads uses 72h as its main comparison; X uses 24h. Exposure and engagement remain separate. |
| Improve the next batch | Next get_generation_brief cycle | Second editorial intervention: use per-account measured results as hypotheses, preserve exploration and avoid claiming that correlation proves causation. | New batch strategy; previously saved drafts and published posts remain unchanged. |

## 2. What the scheduled fallback actually does today

The auto-generate-drafts GitHub Actions workflow runs every two hours. Its script, scripts/auto-generate-drafts.ts, checks each publishing-enabled account's queue and, when the queue is below five, calls generatePost once for that account.

That route is a server-side LLM generation fallback, not the multi-step external-agent route. It does not call get_generation_brief, does not plan a batch and does not run a separate agent tool-use / research loop. The richer agent contract exists in the MCP tools and generation-brief-service.ts, but it only intervenes when an external agent actually invokes those tools.

The workflow comments describe the fallback as necessary while the remote MCP / Vercel path is unavailable. During this implementation session, the Tweets Operator MCP read returned a payment-required response, so live agent connectivity and live account inventory could not be verified. Treat live agent status as unverified until get_system_health succeeds.

## 3. Division of responsibility

### External agent
- Reads get_generation_work and get_generation_brief.
- Curates the external source pool for actual account / audience relevance; high metrics never override topical fit.
- Separates audience-response evidence from the account's own voice and character.
- Plans a batch with different subjects, structures and openings.
- Runs the editorial quality gate and saves drafts with provenance through create_drafts.
- Does not publish, change tokens, change schedules or edit account settings as part of normal replenishment.

### Operator services
- Collects platform data and maintains the API budget.
- Enforces character version, five-draft inventory, post length, duplicate / similarity checks, affiliate / owned-content constraints and Threads topic-tag validity.
- Owns scheduling, publishing, retry / reconciliation and post attribution.
- Captures 24h / 72h performance snapshots and prepares measured pattern summaries.

### Human / owner
- Sets account character, content boundaries, schedule and commercial policy.
- Reviews performance and decides whether to pause an account or change strategy.
- Approves changes to live account settings or automation scope that are not already authorized.

## 4. Conversation and reply strategy

Organic conversation participation is not part of the drafting-agent flow. Existing Amazon / Affiliate Offer reply automation is a separate monetization subsystem with its own eligibility checks, cooldowns and per-sync caps. It is not a general-purpose reply agent.

No broad auto-commenting is being added. A safe reply agent would need to read replies to owned posts and relevant public conversations, draft context-specific responses, enforce per-account rate limits and stop conditions, and save suggested replies for review before any public reply action.

## 5. Measurement cautions

- likeRatio means likes divided by the source account's followers; it is not an impression-normalized engagement rate.
- exposurePerFollower is a rough comparison, not a causal measure of distribution.
- External-source brief samples include higher-exposure, lower-exposure, median-like typical-exposure, higher-like-ratio and recent-contrast lanes. Lower exposure is not proof that the post was bad; every sample still needs account/audience relevance review.
- recent-contrast is a recency sample, not a verified low-performing control group.
- Views, replies, likes, reposts, clicks and sales are different outcomes. A reach improvement is not proof of revenue.
- Fixed-age cohorts reduce age-comparison errors but do not by themselves prove that a particular creative choice caused the result.
