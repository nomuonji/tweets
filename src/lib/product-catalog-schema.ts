import { z } from "zod";

export const PRODUCT_LIFECYCLE_STATES = [
  "discovered",
  "amazon_verified",
  "creative_ready",
  "drafted",
  "posted",
  "evaluated",
] as const;

export const PRODUCT_CREATIVE_STATUSES = [
  "not_started",
  "planned",
  "ready",
  "archived",
] as const;

const optionalUrl = z.string().trim().url().max(1000).optional().or(z.literal(""));

export const creativeAssetSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  provider: z.string().trim().min(1).max(64),
  external_id: z.string().trim().min(1).max(512).optional(),
  path: z.string().trim().min(1).max(1500).optional(),
  public_url: optionalUrl,
  type: z.enum(["image", "video", "other"]).optional(),
  version: z.coerce.number().int().min(1).optional(),
  created_at: z.string().trim().min(1).max(64).optional(),
}).passthrough();

/**
 * Known affiliate-product fields are validated while unknown fields are retained.
 * This is deliberate: the existing catalog already contains agent-authored extension
 * fields and must remain forward/backward compatible.
 */
export const affiliatePostRefSchema = z.object({
  account_id: z.string().trim().min(1).max(256),
  platform: z.enum(["x", "threads"]),
  post_id: z.string().trim().min(1).max(256),
  platform_post_id: z.string().trim().min(1).max(256),
  product_id: z.string().trim().min(1).max(256),
  creative_asset_id: z.string().trim().min(1).max(256).optional(),
  posted_at: z.string().trim().min(1).max(64),
}).passthrough();

export const affiliatePerformanceCheckpointSchema = z.object({
  impressions: z.number().nonnegative().nullable().optional(),
  likes: z.number().nonnegative().optional(),
  replies: z.number().nonnegative().optional(),
  reposts_or_rethreads: z.number().nonnegative().optional(),
  quotes: z.number().nonnegative().optional(),
  link_clicks: z.number().nonnegative().nullable().optional(),
  checked_at: z.string().trim().min(1).max(64).optional(),
  weighted_engagement: z.number().nonnegative().optional(),
  weighted_engagement_rate: z.number().nonnegative().optional(),
  baseline_count: z.number().int().nonnegative().optional(),
  median_impressions: z.number().nonnegative().nullable().optional(),
  median_weighted_engagement_rate: z.number().nonnegative().nullable().optional(),
  impression_ratio: z.number().nonnegative().nullable().optional(),
  engagement_rate_ratio: z.number().nonnegative().nullable().optional(),
}).passthrough();

const affiliatePerformanceResultSchema = z.enum(["strong","neutral","weak","insufficient_baseline","pending"]);

export const affiliatePerformancePostSchema = z.object({
  post_id: z.string().trim().min(1).max(256),
  platform_post_id: z.string().trim().min(1).max(256).optional(),
  account_id: z.string().trim().min(1).max(256).optional(),
  platform: z.enum(["x", "threads"]).optional(),
  creative_asset_id: z.string().trim().min(1).max(256).optional(),
  checkpoints: z.object({ "24h": affiliatePerformanceCheckpointSchema.optional(), "72h": affiliatePerformanceCheckpointSchema.optional() }).passthrough().optional(),
  result: affiliatePerformanceResultSchema.optional(),
}).passthrough();

export const productPerformanceSchema = z.object({
  attempts: z.number().int().nonnegative().optional(),
  strong_count: z.number().int().nonnegative().optional(),
  neutral_count: z.number().int().nonnegative().optional(),
  weak_count: z.number().int().nonnegative().optional(),
  best_result: z.enum(["strong","neutral","weak","insufficient_baseline"]).optional(),
  posts: z.array(affiliatePerformancePostSchema).max(500).optional(),
}).passthrough();

export const productCatalogCreateSchema = z.object({
  asin: z.string().trim().min(3).max(32),
  title: z.string().trim().min(1).max(300),
  url: optionalUrl,
  amazon_url: optionalUrl,
  price: z.string().trim().max(80).optional().or(z.literal("")),
  image_url: optionalUrl,
  category: z.string().trim().max(120).optional().or(z.literal("")),
  theme: z.string().trim().max(160).optional().or(z.literal("")),
  role: z.string().trim().max(80).optional().or(z.literal("")),
  description: z.string().trim().max(3000).optional().or(z.literal("")),
  promo_hook: z.string().trim().max(1000).optional().or(z.literal("")),
  score: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(["candidate", "approved", "archived"]).optional(),
  source_url: optionalUrl,
  notes: z.string().trim().max(3000).optional().or(z.literal("")),

  discovery_source_type: z.string().trim().max(100).optional(),
  discovery_source_url: optionalUrl,
  discovered_at: z.string().trim().min(1).max(64).optional(),
  viral_score: z.coerce.number().min(0).max(100).optional(),
  viral_reasons: z.array(z.string().trim().min(1).max(500)).max(30).optional(),

  creative_concept: z.string().trim().max(3000).optional(),
  creative_assets: z.array(creativeAssetSchema).max(50).optional(),
  creative_version: z.coerce.number().int().min(1).optional(),
  creative_status: z.enum(PRODUCT_CREATIVE_STATUSES).optional(),

  amazon_verified: z.boolean().optional(),
  amazon_verified_at: z.string().trim().min(1).max(64).optional(),
  lifecycle_state: z.enum(PRODUCT_LIFECYCLE_STATES).optional(),
  post_refs: z.array(affiliatePostRefSchema).max(500).optional(),
  performance: productPerformanceSchema.optional(),
  archive_reason: z.string().trim().max(500).optional(),
}).passthrough();

export const productCatalogUpdateSchema = productCatalogCreateSchema.partial();

export function normalizeProductCatalogInput(
  input: Record<string, unknown>,
  mode: "create" | "update",
) {
  const parsed = mode === "create"
    ? productCatalogCreateSchema.parse(input)
    : productCatalogUpdateSchema.parse(input);

  const normalized = { ...parsed } as Record<string, unknown>;
  if (typeof normalized.asin === "string") normalized.asin = normalized.asin.trim().toUpperCase();

  // Existing code treats url as the Amazon product URL. Keep both names interoperable.
  if (!normalized.url && normalized.amazon_url) normalized.url = normalized.amazon_url;
  if (!normalized.amazon_url && normalized.url) normalized.amazon_url = normalized.url;

  if (mode === "create" && normalized.status === undefined) normalized.status = "candidate";
  return normalized;
}
