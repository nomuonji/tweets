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

    return next;
  }, [lookbackDays, maxPosts, selectedAccounts]);

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
            <span className="text-muted-foreground">Lookback days (optional)</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="未指定: 最新投稿20件"
              onChange={(event) => setLookbackDays(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Max posts per account (optional)</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="未指定: 20"
              value={maxPosts}
              onChange={(event) => setMaxPosts(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
        <SyncButton payload={payload} />
      </div>
      <p className="text-xs text-muted-foreground">
        標準設定では、各アカウントの最新投稿を20件まで（期間制限なし）取得します。Lookback daysやMax postsは例外的なケースでのみ入力してください。
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
      </div>
    </div>
  );
}
