"use client";

import { useState } from "react";

export type SyncRequestPayload = {
  lookbackDays?: number;
  maxPosts?: number;
  accountIds?: string[];
  ignoreCursor?: boolean;
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

export function SyncButton({ payload }: SyncButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

    if (typeof payload?.ignoreCursor === "boolean") {
      next.ignoreCursor = payload.ignoreCursor;
    }

    return next;
  };

  const handleSync = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const sanitized = sanitizePayload();
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitized),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "Failed to sync posts");
      }

      const summary = Array.isArray(data.result)
        ? (data.result as SyncResultSummary[])
        : [];
      const totalFetched = summary.reduce(
        (sum: number, item) => sum + (item.fetched ?? 0),
        0,
      );
      const totalAccounts = summary.length;
      const failed = summary.filter((item) => item.error);
      const successful = summary.filter((item) => !item.error);

      const lines: string[] = [];
      if (failed.length > 0) {
        lines.push(
          `Sync finished with errors (${totalFetched} posts / ${totalAccounts} accounts).`,
        );
        failed.forEach((item) => {
          const label =
            item.displayName ||
            item.handle ||
            (item.platform ? `${item.platform}:${item.accountId}` : item.accountId);
          lines.push(`✖ ${label}: ${item.error ?? "Unknown error"}`);
          if (item.debug && item.debug.length > 0) {
            item.debug.forEach((log) => lines.push(`  • ${log}`));
          }
        });
      }

      if (successful.length > 0) {
        lines.push(
          failed.length === 0
            ? totalFetched > 0
              ? `Sync completed (${totalFetched} posts / ${totalAccounts} accounts).`
              : "Sync completed but no new posts were stored."
            : "Successful accounts:",
        );
        successful.forEach((item) => {
          const label =
            item.displayName ||
            item.handle ||
            (item.platform ? `${item.platform}:${item.accountId}` : item.accountId);
          lines.push(
            `✔ ${label}: fetched ${item.fetched ?? 0}, stored ${item.stored ?? 0}`,
          );
          if (item.debug && item.debug.length > 0) {
            item.debug.forEach((log) => lines.push(`  • ${log}`));
          }
        });
      }

      if (lines.length === 0) {
        lines.push("Sync completed (no accounts).");
      }

      setMessage(lines.join("\n"));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleSync}
        disabled={loading}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Sync in progress..." : "Sync latest posts"}
      </button>
      {message && (
        <div className="flex max-w-xl flex-col gap-1 text-xs text-muted-foreground">
          {message.split("\n").map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}



