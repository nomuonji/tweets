export type Platform = "x" | "threads";
export type PromoReplyMode = "off" | "amazon" | "affiliate_offer" | "mixed";
export type MediaType = "text" | "image" | "video";
export type DraftStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type GenerationStrategy = "external";

export type ReferenceAccountStatus = "candidate" | "approved" | "excluded";

export interface PostPattern {
  hook: string;
  structure: string;
  reaction_reason: string;
}

export interface PatternStat {
  structure: string;
  count: number;
  avgEngagementRate: number;
  medianEngagementRate: number;
  totalImpressions: number;
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
}

export interface PatternAnalysis {
  account_id: string;
  /** Character-sheet generation whose posts produced this analysis. */
  character_version?: number;
  accountMedianEngagementRate: number | null;
  patterns: PatternStat[];
  analyzedPosts: number;
  updatedAt: string;
  /** LLM-extracted content-level learnings (topics, traits, experiments). */
  content_insights?: ContentInsight;
}

export interface ContentInsight {
  winning_topics: string[];
  winning_traits: string[];
  losing_topics: string[];
  suggested_experiment: string;
  generatedAt: string;
}

export interface Tip {
  id: string;
  title: string;
  text: string;
  platform: Platform;
  url: string;
  author_handle: string;
  account_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface AccountDoc {
  id: string;
  platform: Platform;
  handle: string;
  display_name: string;
  connected: boolean;
  scopes: string[];
  concept?: string;
  /** Incremented whenever the character sheet changes. Legacy accounts are v1. */
  character_version?: number;
  character_updated_at?: string;
  autoPostEnabled?: boolean;
  postSchedule?: string[];
  minPostLength?: number;
  maxPostLength?: number;
  r18Mode?: boolean;
  discoveryKeywords?: string[];
  referenceAccountIds?: string[];
  generationStrategy?: GenerationStrategy;
  /** 0..1. Probability a generation deliberately tries a new structure/topic
   * instead of repeating the account's proven winners. Defaults to 0.2. */
explorationRate?: number;
  /** Master switch: when on, generated posts may occasionally promote a product. */
  promoEnabled?: boolean;
  /** 0..1. Legacy Amazon product-generation probability. Defaults to 0. */
  promoRate?: number;
  /** 0..1. Affiliate Distribution: deterministic fraction of otherwise eligible
   * viral parent posts that may receive a promo reply. Falls back to promoRate
   * only for backward compatibility when this field is unset. */
  promoReplyRate?: number;
  /** Maximum affiliate promo replies per JST calendar day. Defaults to 2. */
  promoReplyDailyLimit?: number;
  /** Which commerce source may be attached as a reply to a high-performing post.
   * Unset preserves legacy behavior and resolves to Amazon only. */
  promoReplyMode?: PromoReplyMode;
  /** Explicit monetization themes used for contextual Affiliate Offer matching. */
  monetizationThemes?: string[];
  /** False restricts the account to owned_product offers. */
  affiliateThirdPartyEnabled?: boolean;
  /** Master switch: when on, a product-promotion reply is auto-posted under posts
   * that cross the engagement thresholds below. Runs during sync. */
  promoReplyEnabled?: boolean;
  /** Minimum post score (see scoring.ts) for a post to qualify for a promo reply. */
  promoReplyMinScore?: number;
  /** Minimum impressions for a post to qualify for a promo reply. */
  promoReplyMinImpressions?: number;
  /** Only posts created within this many days are eligible (avoids replying to
   * the entire historical backlog on first sync). */
  promoReplyLookbackDays?: number;
  /** Minimum time between two promo replies for this account, to avoid bursts. */
  promoReplyCooldownMinutes?: number;
  /** Last successfully published promo reply. Failures never update this value. */
  lastPromoReplyAt?: string;
  lastPostExecutedAt?: string;
  selectedTipIds?: string[];
  token_meta?: {
    access_token?: string;
    expires_at?: string;
    refreshed_at?: string;
    refresh_token?: string;
    token_type?: string;
    user_id?: string;
    oauth_version?: "oauth1" | "oauth2";
    consumer_key?: string;
    consumer_secret?: string;
    access_token_secret?: string;
    api_key?: string;
    api_host?: string;
  };
  created_at: string;
  updated_at: string;
  sync_cursor?: string;
  error_state?: {
    code: string;
    message: string;
    occurred_at: string;
  };
}

export interface ProductDoc {
  id: string;
  /** Canonical product catalog key when this is an account assignment. */
  catalog_id?: string;
  /** Amazon ASIN identifying the product (e.g. B0XXXXX). */
  asin: string;
  title: string;
  /** Affiliate/plain Amazon product URL. */
  url?: string;
  /** Display price string, e.g. "1,980円". */
  price?: string;
  image_url?: string;
  category?: string;
  /** Why this product suits the account's audience / selling points. */
  description?: string;
  /** A suggested angle for pitching it naturally. */
  promo_hook?: string;
  /** False keeps the product in the DB but excludes it from generation. */
  enabled: boolean;
  /** How many times the product has been selected for a promo. Used for rotation. */
  times_used: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

/** Immutable snapshot of a previously active character sheet. */
export interface CharacterSheetRevision {
  id: string;
  account_id: string;
  character_version: number;
  concept: string;
  activated_at?: string;
  archived_at: string;
}

export type ProductPoolStatus = "candidate" | "approved" | "archived";
export type ProductLifecycleState =
  | "discovered"
  | "amazon_verified"
  | "creative_ready"
  | "drafted"
  | "posted"
  | "evaluated";
export type ProductCreativeStatus = "not_started" | "planned" | "ready" | "archived";

export type AffiliatePerformanceResult =
  | "strong"
  | "neutral"
  | "weak"
  | "insufficient_baseline"
  | "pending";

export interface AffiliatePostRef {
  account_id: string;
  platform: Platform;
  post_id: string;
  platform_post_id: string;
  product_id: string;
  creative_asset_id?: string;
  posted_at: string;
  [key: string]: unknown;
}

export interface AffiliatePerformanceCheckpoint {
  impressions?: number | null;
  likes?: number;
  replies?: number;
  reposts_or_rethreads?: number;
  quotes?: number;
  link_clicks?: number | null;
  checked_at?: string;
  weighted_engagement?: number;
  weighted_engagement_rate?: number;
  baseline_count?: number;
  median_impressions?: number | null;
  median_weighted_engagement_rate?: number | null;
  impression_ratio?: number | null;
  engagement_rate_ratio?: number | null;
  [key: string]: unknown;
}

export interface AffiliatePerformancePost {
  post_id: string;
  platform_post_id?: string;
  account_id?: string;
  platform?: Platform;
  creative_asset_id?: string;
  checkpoints?: {
    "24h"?: AffiliatePerformanceCheckpoint;
    "72h"?: AffiliatePerformanceCheckpoint;
    [key: string]: AffiliatePerformanceCheckpoint | undefined;
  };
  result?: AffiliatePerformanceResult;
  [key: string]: unknown;
}

export interface ProductPerformance {
  attempts?: number;
  strong_count?: number;
  neutral_count?: number;
  weak_count?: number;
  best_result?: Exclude<AffiliatePerformanceResult, "pending">;
  posts?: AffiliatePerformancePost[];
  [key: string]: unknown;
}

export interface CreativeAssetRecord {
  /** Stable asset identifier inside the creative workflow. */
  id?: string;
  /** Storage backend, e.g. google_drive today and cloudflare_r2 later. */
  provider: string;
  /** Provider-native file/object identifier when available. */
  external_id?: string;
  /** Provider-relative path. This is not assumed to be publicly fetchable. */
  path?: string;
  /** Optional public URL; never the canonical identity of the asset. */
  public_url?: string;
  type?: "image" | "video" | "other";
  version?: number;
  created_at?: string;
  [key: string]: unknown;
}

export interface ProductCatalogDoc {
  id: string;
  asin: string;
  title: string;
  /** Legacy/canonical Amazon URL used by existing promotion code. */
  url?: string;
  /** Explicit alias for affiliate discovery workflows. */
  amazon_url?: string;
  price?: string;
  image_url?: string;
  category?: string;
  theme?: string;
  role?: string;
  description?: string;
  promo_hook?: string;
  score?: number;
  /** Catalog moderation state. Do not use this for affiliate workflow progress. */
  status: ProductPoolStatus;
  account_ids?: string[];
  source_url?: string;
  notes?: string;

  // Affiliate discovery metadata. Optional for backward compatibility.
  discovery_source_type?: string;
  discovery_source_url?: string;
  discovered_at?: string;
  viral_score?: number;
  viral_reasons?: string[];

  // Creative preparation. Asset records are storage-provider neutral.
  creative_concept?: string;
  creative_assets?: CreativeAssetRecord[];
  creative_version?: number;
  creative_status?: ProductCreativeStatus;

  // Amazon verification and affiliate workflow progress.
  amazon_verified?: boolean;
  amazon_verified_at?: string;
  lifecycle_state?: ProductLifecycleState;

  // Explicit Product -> Post attribution and measured performance.
  post_refs?: AffiliatePostRef[];
  performance?: ProductPerformance;
  archive_reason?: string;

  created_at: string;
  updated_at: string;

  /** Additional Firestore fields may exist at runtime; MCP passthrough validation preserves them. */
}

/** Backward-compatible name used by the product pool UI. */
export type ProductPoolDoc = ProductCatalogDoc;

export interface ProjectContextDoc {
  id: string;
  key: string;
  kind: "operating_protocol";
  title: string;
  content: string;
  status: "active" | "inactive";
  /** Optimistic-concurrency counter, incremented on every formal context update. */
  revision: number;
  /** Protocol/content version. This is independent from the concurrency revision. */
  version: number | string;
  metadata?: Record<string, unknown>;
  /** Present when the context is sourced from the legacy Global Guidance record. */
  source_guidance_id?: string;
  created_at: string;
  updated_at: string;
}

export interface PromoReplyDoc {
  id: string;
  account_id: string;
  platform: Platform;
  /** The original post this reply is attached to. */
  post_id: string;
  platform_post_id: string;
  /** Id/ASIN of the promoted product. */
  product_id: string;
  product_asin: string;
  text: string;
  /** Explicit lifecycle state. Legacy records are inferred from error/platform_post_id. */
  status?: "posted" | "failed";
  /** Stable category used by retry and monitoring logic. */
  failure_kind?: "provider_unavailable" | "generation" | "publish" | "unknown";
  /** Failed attempts are not retried before this timestamp. */
  retry_after_at?: string;
  created_at: string;
  updated_at: string;
  /** Error message if the immediate publish failed. */
  error?: string;
}

export interface PostMetrics {
  impressions: number | null;
  likes: number;
  replies: number;
  reposts_or_rethreads: number;
  quotes?: number;
  link_clicks?: number | null;
}

export interface PostDoc {
  id: string;
  account_id: string;
  platform: Platform;
  platform_post_id: string;
  text: string;
  created_at: string;
  media_type: MediaType;
  has_url: boolean;
  metrics: PostMetrics;
  score: number;
  /** Character-sheet generation used to create this post. */
  character_version?: number;
  pattern?: PostPattern;
  raw?: Record<string, unknown>;
  raw_gcs_url?: string;
  url?: string;
  fetched_at: string;
  /** Set when a product-promotion or Affiliate Offer reply was posted under this post. */
  promo_replied_at?: string;
  /** Explicit Affiliate Offer -> reply -> parent attribution. */
  affiliate_reply_id?: string;
  affiliate_offer_id?: string;
  affiliate_reply_platform_id?: string;
  /** Internal attribution survives platform re-sync because posts are merge-upserted. */
  affiliate_product_id?: string;
  affiliate_creative_id?: string;
  /** Owned-content attribution. Kept separate from affiliate offers/products. */
  owned_content_item_id?: string;
  owned_content_source_id?: string;
  owned_content_url?: string;
  owned_content_source_type?: "website" | "note" | "newsletter" | "other";
  source_draft_id?: string;
  affiliate_link_status?: "pending" | "linked";
  affiliate_link_error?: string | null;
  affiliate_linked_at?: string;
  affiliate_link_updated_at?: string;
  publish_cleanup_pending?: boolean;
  schedule_reconciliation_pending?: boolean;
}

export interface ReferenceAccountDoc {
  id: string;
  platform: "x";
  handle: string;
  display_name?: string;
  status: ReferenceAccountStatus;
  source_keyword?: string;
  created_at: string;
  updated_at: string;
  last_synced_at?: string;
  error_state?: {
    message: string;
    occurred_at: string;
  };
}

export interface ExternalPostDoc {
  id: string;
  platform: "x";
  platform_post_id: string;
  author_handle: string;
  author_followers?: number | null;
  text: string;
  created_at: string;
  url?: string;
  metrics: PostMetrics;
  search_keyword?: string;
  source_account_id?: string;
  fetched_at: string;
  engagement_rate?: number | null;
  pattern?: {
    hook: string;
    structure: string;
    reaction_reason: string;
  };
}

export interface DraftDoc {
  id: string;
  target_platform: Platform;
  target_account_id?: string;
  base_post_id?: string | null;
  text: string;
  hashtags: string[];
  status: DraftStatus;
  schedule_time?: string | null;
  published_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  similarity_warning?: boolean;
  /** Character-sheet generation used to create this draft. */
  character_version?: number;
  generatedBy?: string;
  /** Set when this draft is a product-promotion post. */
  promo_product_id?: string;
  promo_product_asin?: string;
  /** Explicit affiliate attribution. Optional for normal drafts. */
  affiliate_product_id?: string;
  affiliate_creative_id?: string;
  /** Explicit owned-content attribution. Website is only one supported source type. */
  owned_content_item_id?: string;
  owned_content_source_id?: string;
  owned_content_url?: string;
  owned_content_source_type?: "website" | "note" | "newsletter" | "other";
  /** The post structure type used for this draft, used by the self-improvement loop. */
  pattern?: PostPattern;
  /** When the scheduler took the `publishing` lock; used to reclaim stale locks. */
  publishing_started_at?: string;
  /** Durable checkpoint for crash recovery of multi-step platform publishing. */
  publish_stage?:
    | "creating_container"
    | "container_created"
    | "container_ready"
    | "publishing"
    | "reconciling";
  publish_attempt_count?: number;
  publish_creation_id?: string | null;
  publish_stage_updated_at?: string;
  publish_failure_count?: number;
  next_publish_attempt_at?: string | null;
  /** Set when a publish attempt failed; the draft is kept for retry. */
  last_error?: {
    message: string;
    occurred_at: string;
  };
}

export interface SettingsDoc {
  id: string;
  scoring: {
    use_impression_proxy: boolean;
    proxy_strategy: "median" | "1";
  };
  generation: {
    max_hashtags: number;
    preferred_length: [number, number];
  };
  slots: {
    x: string[];
    threads: string[];
  };
  timezone?: string;
}

export interface RankingFilter {
  platform: Platform | "all";
  media_type: MediaType | "all";
  period_days: 7 | 30 | 90 | "all";
  accountId?: string;
}

export interface ScoreOptions {
  settings: SettingsDoc["scoring"];
  proxyValue?: number;
}

export interface ExemplaryPost {
  id: string;
  text: string;
  explanation: string;
  created_at: string;
  updated_at: string;
}
