import { MediaType, Platform, PostMetrics } from "@/lib/types";

export interface SyncPostPayload {
  platform: Platform;
  platform_post_id: string;
  text: string;
  created_at: string;
  media_type: MediaType;
  has_url: boolean;
  metrics: PostMetrics;
  raw: Record<string, unknown>;
  url?: string;
  raw_gcs_url?: string;
}

export interface PublishResult {
  platform_post_id: string;
  url?: string;
  raw: Record<string, unknown>;
}
