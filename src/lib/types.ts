export type Platform = "x" | "threads";
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
  /** 0..1. Probability a single generation promotes a product. Defaults to 0. */
  promoRate?: number;
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

export type ProductPoolStatus = "candidate" | "approved" | "archived";

export interface ProductCatalogDoc {
  id: string;
  asin: string;
  title: string;
  url?: string;
  price?: string;
  image_url?: string;
  category?: string;
  theme?: string;
  role?: string;
  description?: string;
  promo_hook?: string;
  score?: number;
  status: ProductPoolStatus;
  account_ids?: string[];
  source_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/** Backward-compatible name used by the product pool UI. */
export type ProductPoolDoc = ProductCatalogDoc;

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
  /** Set when a product-promotion reply was posted under this post. */
  promo_replied_at?: string;
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
  /** The post structure type used for this draft, used by the self-improvement loop. */
  pattern?: PostPattern;
  /** When the scheduler took the `publishing` lock; used to reclaim stale locks. */
  publishing_started_at?: string;
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
