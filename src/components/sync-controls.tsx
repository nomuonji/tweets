"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccountContext } from "./account/account-provider";
import { SyncButton, type SyncRequestPayload } from "./sync-button";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn, platformLabel } from "@/lib/utils";

const SYNC_SCOPE_STORAGE_KEY = "sync-scope-account-ids";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
  const { selectedAccount } = useAccountContext();
  const selectedAccountId = selectedAccount?.id ?? null;

  const [lookbackDays, setLookbackDays] = useState("");
  const [maxPosts, setMaxPosts] = useState("");
  const [scopedAccountIds, setScopedAccountIds] = useState<string[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoverySummary, setDiscoverySummary] = useState<string | null>(null);

  const currentAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId),
    [accounts, selectedAccountId],
  );

  const defaultPostCount = currentAccount?.platform === "threads" ? 100 : 20;

  // Restore the previously used scope, falling back to the active account.
  useEffect(() => {
    let stored: string[] | null = null;
    try {
      const cookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${SYNC_SCOPE_STORAGE_KEY}=`));
      if (cookie) {
        const parsed = JSON.parse(decodeURIComponent(cookie.split("=")[1]));
        if (Array.isArray(parsed)) stored = parsed;
      }
    } catch (error) {
      console.error("Failed to parse sync scope from cookie", error);
    }

    if (stored && stored.length > 0) {
      setScopedAccountIds(stored);
    } else if (selectedAccountId) {
      setScopedAccountIds([selectedAccountId]);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    try {
      const expires = new Date(Date.now() + COOKIE_MAX_AGE_MS).toUTCString();
      document.cookie = `${SYNC_SCOPE_STORAGE_KEY}=${encodeURIComponent(
        JSON.stringify(scopedAccountIds),
      )}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (error) {
      console.error("Failed to save sync scope to cookie", error);
    }
  }, [scopedAccountIds]);

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

    if (scopedAccountIds.length > 0) {
      next.accountIds = scopedAccountIds;
    } else if (selectedAccountId) {
      next.accountIds = [selectedAccountId];
    }

    return next;
  }, [lookbackDays, maxPosts, scopedAccountIds, selectedAccountId]);

  const toggleAccount = (accountId: string) => {
    setScopedAccountIds((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId],
    );
  };

  const handleDiscoverySync = async () => {
    setDiscoveryLoading(true);
    setDiscoverySummary(null);
    try {
      const response = await fetch("/api/discovery/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: scopedAccountIds.length > 0 ? scopedAccountIds : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message ?? "外部探索に失敗しました。");
      const refreshed = data.result.reduce(
        (count: number, item: { synced?: string[] }) => count + (item.synced?.length ?? 0),
        0,
      );
      setDiscoverySummary(
        refreshed > 0 ? `外部の参考投稿を ${refreshed} 系統更新しました。` : "外部データは新しく、追加取得を省略しました。",
      );
    } catch (error) {
      setDiscoverySummary((error as Error).message);
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const scopeSummary =
    scopedAccountIds.length > 0
      ? `${accounts.length}件中 ${scopedAccountIds.length}件を選択中`
      : selectedAccountId
        ? "選択中のアカウントのみ（既定）"
        : `全 ${accounts.length} アカウント`;

  return (
    <Card className="h-full">
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <Field label="取得期間（日数）" hint="未入力なら期間制限なし">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="期間制限なし"
                  value={lookbackDays}
                  onChange={(event) => setLookbackDays(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="1アカウントあたりの最大件数"
              hint={`未入力なら ${defaultPostCount} 件`}
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder={String(defaultPostCount)}
                  value={maxPosts}
                  onChange={(event) => setMaxPosts(event.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <SyncButton payload={payload} />
            <Button
              variant="outline"
              loading={discoveryLoading}
              onClick={handleDiscoverySync}
            >
              {discoveryLoading ? "探索中..." : "外部の勝ち筋を更新"}
            </Button>
          </div>
        </div>
        {discoverySummary ? (
          <p className="text-xs text-muted-foreground">{discoverySummary}</p>
        ) : null}

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              同期するアカウント
            </p>
            {scopedAccountIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setScopedAccountIds([])}
                className="text-xs text-primary hover:underline"
              >
                選択を解除
              </button>
            ) : null}
          </div>

          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              連携済みのアカウントがありません。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((account) => {
                const isSelected = scopedAccountIds.includes(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleAccount(account.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                    )}
                  >
                    @{account.handle}
                    <span className="ml-1 opacity-70">
                      {platformLabel(account.platform)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{scopeSummary}</p>
        </div>
      </CardContent>
    </Card>
  );
}
