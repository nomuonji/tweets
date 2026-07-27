"use client";

import { DateTime } from "luxon";
import type { AccountDoc, DraftDoc } from "@/lib/types";
import { platformLabel } from "@/lib/utils";
import {
  DRAFT_STATUS_LABELS,
  DRAFT_STATUS_VARIANTS,
  EDITABLE_DRAFT_STATUSES,
} from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertIcon,
  InboxIcon,
  PencilIcon,
  SendIcon,
  TrashIcon,
} from "@/components/ui/icons";

type DraftListProps = {
  drafts: DraftDoc[];
  accountLookup: Map<string, AccountDoc>;
  fallbackAccount: AccountDoc | null;
  hasError: boolean;
  /** Draft ids with an action currently in flight. */
  pendingIds: Set<string>;
  onEdit: (draft: DraftDoc) => void;
  onDelete: (draft: DraftDoc) => void;
  onPublish: (draft: DraftDoc) => void;
  onStatusChange: (draft: DraftDoc, status: DraftDoc["status"]) => void;
};

function formatTimestamp(draft: DraftDoc, zone: string) {
  const schedule = draft.schedule_time
    ? DateTime.fromISO(draft.schedule_time)
    : null;
  if (schedule?.isValid) {
    return `予約 ${schedule.setZone(zone).toFormat("M/d HH:mm")}`;
  }
  const updated = DateTime.fromISO(draft.updated_at);
  if (updated.isValid) {
    return `更新 ${updated.setZone(zone).toRelative({ unit: ["days", "hours", "minutes"] }) ?? updated.setZone(zone).toFormat("M/d HH:mm")}`;
  }
  return "日時不明";
}

export function DraftList({
  drafts,
  accountLookup,
  fallbackAccount,
  hasError,
  pendingIds,
  onEdit,
  onDelete,
  onPublish,
  onStatusChange,
}: DraftListProps) {
  const zone = DateTime.local().zoneName;

  if (hasError) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertIcon className="h-5 w-5" />}
        title="下書きを読み込めませんでした"
        description="時間をおいて再読み込みするか、サーバーログを確認してください。"
      />
    );
  }

  if (drafts.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon className="h-5 w-5" />}
        title="下書きはまだありません"
        description="上の生成フォームから新しい投稿案を作成できます。"
      />
    );
  }

  return (
    <ul className="space-y-3">
      {drafts.map((draft) => {
        const account = draft.target_account_id
          ? (accountLookup.get(draft.target_account_id) ?? fallbackAccount)
          : fallbackAccount;
        const isPending = pendingIds.has(draft.id);

        return (
          <li
            key={draft.id}
            className="rounded-lg border border-border bg-background p-4 transition-colors hover:border-muted-foreground/30"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={DRAFT_STATUS_VARIANTS[draft.status]}>
                {DRAFT_STATUS_LABELS[draft.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {account
                  ? `${platformLabel(account.platform)} · @${account.handle}`
                  : platformLabel(draft.target_platform)}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(draft, zone)}
              </span>
              {draft.generatedBy ? (
                <span className="text-xs text-muted-foreground">
                  · {draft.generatedBy} 生成
                </span>
              ) : null}
            </div>

            <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed">
              {draft.text}
            </p>

            {draft.last_error ? (
              <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                投稿に失敗しました: {draft.last_error.message}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Select
                value={draft.status}
                disabled={isPending}
                aria-label="ステータスを変更"
                onChange={(event) =>
                  onStatusChange(
                    draft,
                    event.target.value as DraftDoc["status"],
                  )
                }
                className="h-8 w-auto text-xs"
              >
                {EDITABLE_DRAFT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {DRAFT_STATUS_LABELS[status]}
                  </option>
                ))}
                {/* Keep transient states selectable-as-current so the control
                    always reflects the draft's real status. */}
                {EDITABLE_DRAFT_STATUSES.includes(draft.status) ? null : (
                  <option value={draft.status}>
                    {DRAFT_STATUS_LABELS[draft.status]}
                  </option>
                )}
              </Select>

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onEdit(draft)}
                  disabled={isPending}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  編集
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(draft)}
                  disabled={isPending}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  削除
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={isPending}
                  onClick={() => onPublish(draft)}
                >
                  {isPending ? null : <SendIcon className="h-3.5 w-3.5" />}
                  今すぐ投稿
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
