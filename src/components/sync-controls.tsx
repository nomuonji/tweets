"use client";

import { useMemo, useState, useEffect } from "react";

import { SyncButton, SyncRequestPayload } from "./sync-button";

const SYNC_SCOPE_STORAGE_KEY = "sync-scope-account-ids";

type AccountOption = {
  id: string;
  handle: string;
  displayName: string;
  platform: string;
};

import { useAccountContext } from "./account/account-provider";

type SyncControlsProps = {
  accounts: AccountOption[];
};

export function SyncControls({ accounts }: SyncControlsProps) {
  const { selectedAccount } = useAccountContext();
  const selectedAccountId = selectedAccount?.id ?? null;

  const [lookbackDays, setLookbackDays] = useState("");
  const [maxPosts, setMaxPosts] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const currentAccount = useMemo(
    () => accounts.find((acc) => acc.id === selectedAccountId),
    [accounts, selectedAccountId],
  );

  const defaultPostCount = currentAccount?.platform === "threads" ? 100 : 20;
  const lookbackPlaceholder = "期間制限なし";
  const maxPostsPlaceholder = `未指定: ${defaultPostCount}`;

  useEffect(() => {
    let cookieValue: string[] | null = null;
    try {
      const item = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${SYNC_SCOPE_STORAGE_KEY}=`));
      if (item) {
        const parsed = JSON.parse(decodeURIComponent(item.split("=")[1]));
        if (Array.isArray(parsed)) {
          cookieValue = parsed;
        }
      }
    } catch (error) {
      console.error("Failed to parse sync scope from cookie", error);
    }

    if (cookieValue && cookieValue.length > 0) {
      setSelectedAccounts(cookieValue);
    } else if (selectedAccountId) {
      setSelectedAccounts([selectedAccountId]);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    try {
      const value = JSON.stringify(selectedAccounts);
      const expires = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toUTCString();
      document.cookie = `${SYNC_SCOPE_STORAGE_KEY}=${encodeURIComponent(
        value,
      )}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (error) {
      console.error("Failed to save sync scope to cookie", error);
    }
  }, [selectedAccounts]);

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
    } else if (selectedAccountId) {
      next.accountIds = [selectedAccountId];
    }

    return next;
  }, [lookbackDays, maxPosts, selectedAccounts, selectedAccountId]);

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
      : selectedAccountId
        ? "1 account (default)"
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
              placeholder={lookbackPlaceholder}
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
              placeholder={maxPostsPlaceholder}
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
