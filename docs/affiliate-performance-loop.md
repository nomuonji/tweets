# Affiliate Product Performance Loop

Repository contract for Product -> Creative -> Draft -> Published Post -> 24h/72h Performance -> product lifecycle.

## Data model

- /products/{productId} is canonical.
- Affiliate drafts optionally store affiliate_product_id and affiliate_creative_id; ordinary drafts omit them.
- Published posts copy attribution plus source_draft_id.
- product.post_refs[] contains account_id, platform, internal post_id, platform_post_id, product_id, optional creative_asset_id, and posted_at.
- product.performance stores aggregate counts and per-post 24h/72h checkpoints. Unknown extension fields remain preserved.

## MCP draft contract

create_drafts keeps its old shape and adds optional affiliate: { productId, creativeAssetId? }. productId must exist before the draft transaction commits.

## Publish and duplicate prevention

1. Persist a publish checkpoint before the X side effect; Threads keeps its existing checkpoints.
2. On an ambiguous retry, reconcile the external platform first. X exact-matches full text among posts since the attempt start.
3. Persist the posts document immediately after external success. This is the durable external-success fact.
4. Link product.post_refs[] transactionally and dedupe by platform + platform_post_id.
5. Product-link or cleanup failure after step 3 is non-fatal and never triggers another external publish.

A failed Product link leaves affiliate_link_status=pending. sync_posts merge-upserts metrics, preserves internal metadata, and retries link reconciliation.

## Performance

Weighted engagement = likes + 2*reposts_or_rethreads + 2*replies + 2*quotes + 3*link_clicks. link_clicks=null remains null and is treated as zero only during calculation.

72h uses the same account/platform tracked affiliate posts, normally the latest 20, minimum 5. strong: impression_ratio >= 1.5 OR engagement_rate_ratio >= 1.5. weak: impression_ratio < 0.6 AND engagement_rate_ratio < 0.8. Otherwise neutral. Under 5 baselines is insufficient_baseline. Missing/zero impressions is pending. 24h is provisional only.

## Archive

Automatic archive eligibility requires two 72h weak results from two different creative_asset_id values and no strong history. archive_product accepts optional reason; use underperformed_after_2_posts for this case. One weak result never auto-archives the product.

## Scheduled Task split

The existing ChatGPT task reads affiliate_product_performance_v1, runs sync_posts, reads get_product_performance_work, saves checkpoints through save_product, and archives only when the protocol allows it. Discovery remains isolated under affiliate_product_discovery_v1.

## Creative Worker extension

A future Codex Creative Worker only needs to create/update creative_assets[], choose a stable creative_asset_id, and pass it with productId to create_drafts. Publishing/performance remain separate.

## Migration

No destructive migration is required. All new fields are optional and existing documents remain valid.
