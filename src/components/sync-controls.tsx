"use client";

import { useMemo, useState } from "react";

import { SyncButton, SyncRequestPayload } from "./sync-button";

type AccountOption = {
  id: string;
  handle: string;
  displayName: string;
  platform: string;
};

type SyncControlsProps = {
  accounts: AccountOption[];
};

export function SyncControls({ accounts }: SyncControlsProps) {
  const [lookbackDays, setLookbackDays] = useState("");
  const [maxPosts, setMaxPosts] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [backfill, setBackfill] = useState(false);

  const payload = useMemo<SyncRequestPayload>(() => {
    const next: SyncRequestPayload = {};

    const lookbackValue = Number.parseInt(lookbackDays, 10);
    if (!Number.isNaN(lookbackValue) && lookbackValue > 0) {
      next.lookbackDays = lookbackValue;
    }

    const maxPostsValue = Number.parseInt(maxPosts, 10);
    if (!Number.isNaN(maxPostsValue) && maxPostsValue > 0) {
      next.maxPosts = maxPostsValue;
    }

    if (selectedAccounts.length > 0) {
      next.accountIds = selectedAccounts;
    }

    if (backfill) {
      next.ignoreCursor = true;
    }

    return next;
  }, [lookbackDays, maxPosts, selectedAccounts, backfill]);

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts((previous) =>
      previous.includes(accountId)
        ? previous.filter((id) => id !== accountId)
        : [...previous, accountId],
    );
  };

  const clearSelection = () => setSelectedAccounts([]);

  const selectionSummary =
    selectedAccounts.length > 0
      ? `${selectedAccounts.length} of ${accounts.length} selected`
      : `All ${accounts.length} accounts`;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Lookback days</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="デフォルト: 増分同期"
              onChange={(event) => setLookbackDays(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Max posts per account</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="デフォルト: 1000"
              value={maxPosts}
              onChange={(event) => setMaxPosts(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
        <SyncButton payload={payload} />
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>バックフィルモード</strong>: このオプションをオンにすると、過去のすべての投稿を最初から取得し直します。古い投稿をまとめてインポートしたい場合に使用します。オフのまま同期すると、前回同期した箇所から新しい投稿のみを取得します。
      </p>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Limit sync scope (optional)</span>
          {selectedAccounts.length > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="text-primary hover:underline"
            >
              Clear selection
            </button>
          )}
        </div>

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No connected accounts available.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((account) => {
              const isSelected = selectedAccounts.includes(account.id);
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => toggleAccount(account.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    isSelected
                      ? "border-primary bg-surface-active text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
                  }`}
                >
                  {account.displayName
                    ? `${account.displayName} (@${account.handle})`
                    : `@${account.handle}`}
                </button>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{selectionSummary}</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={backfill}
            onChange={(event) => setBackfill(event.target.checked)}
          />
          <span>過去の全投稿を取得し直す (バックフィルモード)</span>
        </label>
      </div>
    </div>
  );
}
