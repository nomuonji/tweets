import type { BadgeVariant } from "@/components/ui/badge";
import type { DraftStatus, MediaType } from "./types";

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  draft: "下書き",
  scheduled: "予約済み",
  publishing: "投稿処理中",
  published: "投稿済み",
  failed: "投稿失敗",
};

export const DRAFT_STATUS_VARIANTS: Record<DraftStatus, BadgeVariant> = {
  draft: "default",
  scheduled: "primary",
  publishing: "warning",
  published: "success",
  failed: "destructive",
};

/** Statuses a user may pick manually; transient states are excluded. */
export const EDITABLE_DRAFT_STATUSES: DraftStatus[] = [
  "draft",
  "scheduled",
  "published",
];

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  text: "テキスト",
  image: "画像",
  video: "動画",
};
