"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type SyncRequestPayload = {
  lookbackDays?: number;
  maxPosts?: number;
  accountIds?: string[];
};

type SyncButtonProps = {
  payload?: SyncRequestPayload;
};

type SyncResultSummary = {
  accountId: string;
  handle?: string;
  displayName?: string;
  platform?: string;
  fetched?: number;
  stored?: number;
  error?: string;
  debug?: string[];
};

type ResultLine = {
  ok: boolean;
  label: string;
  detail: string;
};

function labelFor(item: SyncResultSummary) {
  return (
    item.displayName ||
    (item.handle ? `@${item.handle}` : "") ||
    (item.platform ? `${item.platform}:${item.accountId}` : item.accountId)
  );
}

export function SyncButton({ payload }: SyncButtonProps) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [lines, setLines] = useState<ResultLine[]>([]);
  const [failed, setFailed] = useState(false);

  const sanitizePayload = () => {
    const next: SyncRequestPayload = {};

    if (
      typeof payload?.lookbackDays === "number" &&
      Number.isFinite(payload.lookbackDays) &&
      payload.lookbackDays > 0
    ) {
      next.lookbackDays = Math.trunc(payload.lookbackDays);
    }

    if (
      typeof payload?.maxPosts === "number" &&
      Number.isFinite(payload.maxPosts) &&
      payload.maxPosts > 0
    ) {
      next.maxPosts = Math.trunc(payload.maxPosts);
    }

    if (Array.isArray(payload?.accountIds) && payload.accountIds.length > 0) {
      next.accountIds = payload.accountIds;
    }

    return next;
  };

  const handleSync = async () => {
    setLoading(true);
    setSummary(null);
    setLines([]);
    setFailed(false);

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitizePayload()),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "同期に失敗しました。");
      }

      const results = Array.isArray(data.result)
        ? (data.result as SyncResultSummary[])
        : [];

      if (results.length === 0) {
        setSummary("対象のアカウントがありませんでした。");
        return;
      }

      const totalFetched = results.reduce(
        (sum, item) => sum + (item.fetched ?? 0),
        0,
      );
      const errored = results.filter((item) => item.error);

      setFailed(errored.length > 0);
      setSummary(
        errored.length > 0
          ? `${results.length}件中 ${errored.length}件でエラーが発生しました（取得 ${totalFetched}件）。`
          : totalFetched > 0
            ? `同期が完了しました（取得 ${totalFetched}件 / ${results.length}アカウント）。`
            : "同期は完了しましたが、新しい投稿はありませんでした。",
      );

      setLines(
        results.map((item) => ({
          ok: !item.error,
          label: labelFor(item),
          detail: item.error
            ? item.error
            : `取得 ${item.fetched ?? 0}件・保存 ${item.stored ?? 0}件`,
        })),
      );
    } catch (error) {
      setFailed(true);
      setSummary((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button loading={loading} onClick={handleSync}>
        {loading ? null : <RefreshIcon className="h-4 w-4" />}
        {loading ? "同期中..." : "最新の投稿を同期"}
      </Button>

      {summary ? (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            failed
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-success/30 bg-success/5 text-foreground",
          )}
        >
          <p className="font-medium">{summary}</p>
          {lines.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {lines.map((line, index) => (
                <li
                  key={index}
                  className={cn(
                    "flex gap-1.5",
                    line.ok ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  <span aria-hidden="true">{line.ok ? "✔" : "✖"}</span>
                  <span className="min-w-0">
                    <span className="font-medium">{line.label}</span>：
                    {line.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
