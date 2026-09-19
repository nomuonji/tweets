# Affiliate Product Agent Architecture

## Purpose

Tweets Operator is the persistent source of truth for the affiliate-product workflow:

public-Web discovery -> Amazon verification -> creative preparation -> draft -> publish -> evaluation.

Chat history is not a required dependency. Google Drive is temporary asset storage, not the product database.

## Persistent operator context

Formal operating protocols live in Firestore at `/operator_contexts/{key}`.

MCP:
- `get_project_context`: one-call read of the active protocol.
- `update_project_context`: optimistic update using `expectedRevision`.
- `get_product_discovery_work`: protocol + recent catalog/ASIN/lifecycle snapshot for discovery agents.

The initial key is `affiliate_product_discovery_v1`.

Backward compatibility is intentional. If `/operator_contexts/affiliate_product_discovery_v1` does not yet exist, `get_project_context` reads the legacy Global Guidance record whose `protocol_key` is `affiliate_product_discovery_v1`. The legacy `[SYSTEM] Affiliate Product Discovery Protocol` record is not deleted because existing Scheduled Tasks may still fall back to `list_guidance`.

A formal update materializes the context into `operator_contexts`; `revision` is the concurrency counter while `version` is the protocol/content version.

## Product catalog contract

The canonical product remains `/products/{ASIN}`; account subcollections remain assignments only.

Existing catalog fields remain valid. New affiliate fields are optional:

- Discovery: `discovery_source_type`, `discovery_source_url`, `discovered_at`, `viral_score`, `viral_reasons`
- Creative: `creative_concept`, `creative_assets[]`, `creative_version`, `creative_status`
- Amazon: `amazon_verified`, `amazon_verified_at`, `amazon_url`
- Workflow: `lifecycle_state`

`status` is deliberately NOT repurposed. It stays the legacy catalog moderation state: `candidate | approved | archived`.

`lifecycle_state` is the affiliate workflow:

`discovered -> amazon_verified -> creative_ready -> drafted -> posted -> evaluated`

The MCP validator is backward-compatible: known fields are validated, but unknown agent-authored extension fields are preserved. Existing products therefore require no destructive migration.

## Creative asset abstraction

`creative_assets[]` is storage-provider neutral:

- `id`
- `provider`
- `external_id`
- `path`
- `public_url` (optional)
- `type`
- `version`
- `created_at`

Current Drive convention may use:

`/Google Drive/Affiliate Product Discovery/creatives/<ASIN>/`

Do not treat a Drive URL as the permanent asset identity. A later Cloudflare R2 migration can update the provider metadata without changing the product identity.

## Job isolation

Discovery jobs may read Context/catalog and save candidate products. They must not publish or mutate ordinary posting inventory.

Discovery allowed operations:
- `get_project_context`
- `get_product_discovery_work`
- `list_products`
- `save_product`

Discovery must not call:
- `publish_draft`
- `create_drafts`
- `update_account`
- `update_draft` / `delete_draft`
- `archive_product`
- guidance deletion

Creative, Draft, Publish, and Evaluation remain separate jobs.

## Attribution / feedback-loop extension point

Stable product identity is the ASIN-backed product document ID. Creative assets already have an optional stable `id`.

Types now reserve `affiliate_creative_id` on drafts and `affiliate_product_id` / `affiliate_creative_id` on posts, but current publishing/sync logic does not populate them. This is intentional: attribution should be added with the Creative/Draft job rather than coupled into Product Discovery.

A future implementation can add a dedicated creative entity (for example `/affiliate_creatives/{creativeId}`) and persist:
- product ID / ASIN
- creative ID + version
- draft ID
- platform post ID
- impressions / likes / reposts / replies / link clicks
- Amazon conversion/revenue metrics when available

This enables analysis of “product x creative x hook x post” without changing product identity.

## Intentionally not implemented yet

- No image generation job.
- No automatic Google Drive writes.
- No Cloudflare R2 dependency.
- No automatic draft creation or publishing from Discovery.
- No Amazon conversion ingestion.
- No automatic lifecycle transitions based on post metrics.
- No destructive rewrite of existing products.
- No deletion of the legacy Guidance protocol.

These are deferred until the initial discovery/creative/post sample has enough evidence to justify more automation.
