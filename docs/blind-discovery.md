# Independent Blind Discovery

## Purpose

Collect public X posts from a discovery path that is independent of account personas, account keyword lists, reference-account lists, existing drafts, and account performance analytics. The collector is a market-observation input, not a draft generator.

## Acquisition policy

- A fixed 20-query seed deck alternates Japanese and English everyday-language observations across several broad themes.
- One seed is selected per JST calendar day using a persistent round-robin cursor. The next seed is selected only after both acquisition lanes complete successfully.
- Each seed is searched independently through X search in both `Top` and `Latest` lanes, requesting at most 20 text posts per lane.
- The collector does not read account documents, personas, reference accounts, account keywords, drafts, performance stats, or the Buzz Harness packet when selecting a query.
- Retweets, replies, media posts, entries without text, and entries without an identifiable author are not used as text observations.
- A concurrent-run lease prevents overlapping scheduled/manual invocations from consuming the same cursor.
- Every run is recorded in `external_blind_discovery_runs`. The global cursor and completion date are stored in `external_blind_discovery_state/global`.

## Budget controls

The collector uses the shared `rapidapi_twitter` monthly counter. It makes no request unless an explicit monthly budget is configured and at least two requests remain. The workflow sets `RAPIDAPI_MONTHLY_BUDGET=800`; a Firestore budget setting takes precedence when present. Before starting the Latest lane, it checks the remaining budget again.

The expected incremental cost is two search requests per successful daily run (approximately 60 per 30-day month), before retries. It never loops through the seed deck in one run.

## Evidence storage

`external_posts` remains the mutable canonical content snapshot used by the application. A later account-keyword or reference-account fetch can update the acquisition fields on that document.

Blind discovery proof therefore lives separately in `external_post_observations`. Each record is created once with Firestore `create()`, using an ID derived from run, X post ID, and acquisition lane. It stores:

- The canonical external-post ID, X post ID, author, canonical URL, and source-text SHA-256.
- The original query, deterministic query ID, seed ID/theme/language, and run ID.
- `discovery_origin=blind_discovery`, `source_type=account_independent_query`, the `Top`/`Latest` lane, fetch time, and collector version.
- The captured post metrics and author follower count when available.

A retry may reuse an identical existing receipt but cannot overwrite it. A changed source-text hash, URL, query or lane for the same receipt identity causes a hard failure rather than rewriting history.

## Buzz Harness validation

For a `blind_discovery` cluster, the Harness now requires an append-only receipt matching the source post and cluster:

- The exact query identity and query string.
- The canonical post ID, author, URL, and exact source-text hash.
- The acquisition lane and a fetch timestamp within the last 30 days.
- The server collector's source type and version.

The Harness derives Blind query, lane and freshness evidence from these immutable receipts rather than mutable acquisition fields on `external_posts`. It binds the receipt snapshot into the Harness report hash and audit document. A caller-supplied packet label is still insufficient.

Account-keyword seed-followup clusters continue to use their own server-written acquisition fields. Reference-account acquisition is never reclassified as Blind discovery.

## Verification and safety boundaries

- `npm run test:blind-discovery` tests seed rotation, retry determinism, Top/Latest coverage and append-only receipt identities.
- `npm run test:buzz-harness` includes forged/missing receipt rejection, resilience to later mutable-metadata overwrites, and lane-integrity regressions.
- `npm run sync:blind` is the scheduled collector entry point. It writes only external post snapshots, immutable observation receipts, and run/cursor state.
- It never writes `drafts`, invokes a publishing endpoint, or changes account settings.
- Passing source-provenance validation does not imply a complete X crawl, a representative sample, or prediction of virality. It is evidence that the captured post was found through this independent search path.
- The collector still relies on the configured RapidAPI provider and GitHub Actions secrets. Successful CI does not prove that production secrets, quota, provider response shape, or runtime permissions are working. Confirm the first scheduled run with the run audit and observation receipt readback.
