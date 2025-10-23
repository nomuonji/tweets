export type Platform = "x" | "threads";
export type MediaType = "text" | "image" | "video";
export type DraftStatus = "draft" | "scheduled" | "published";

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
  autoPostEnabled?: boolean;
  postSchedule?: string[];
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
  raw?: Record<string, unknown>;
  raw_gcs_url?: string;
  url?: string;
  fetched_at: string;
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
