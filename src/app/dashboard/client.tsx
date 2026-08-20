"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AccountDoc, PostDoc, DraftDoc } from "@/lib/types";
import { SyncControls } from "@/components/sync-controls";
import { SmartTweetGenerator } from "@/components/smart-tweet-generator";
import { useAccountContext } from "@/components/account/account-provider";
import { Button, linkButton } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { AlertIcon, PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { DraftList } from "./draft-list";
import { AccountOverview } from "./account-overview";

type AccountData = {
  stats: { postCount: number; bestPost: PostDoc | null };
  recentPosts: PostDoc[];
};

type DashboardClientProps = {
  initialAccounts: AccountDoc[];
  initialApiUsage: { month: string; count: number };
  initialDrafts: DraftDoc[];
  initialAccountData: AccountData | null;
  errors: {
    accountsError: boolean;
    draftsError: boolean;
    accountDataError: boolean;
    quotaExceeded: boolean;
  };
};

export function DashboardClient({
  initialAccounts,
  initialApiUsage,
  initialDrafts,
  initialAccountData,
  errors,
}: DashboardClientProps) {
  const { selectedAccount } = useAccountContext();
  const toast = useToast();
  const confirm = useConfirm();

  const [accounts] = useState(initialAccounts);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [accountData, setAccountData] = useState(initialAccountData);
  const [isLoading, setIsLoading] = useState(false);

  const [editingDraft, setEditingDraft] = useState<DraftDoc | null>(null);
  const [editedText, setEditedText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const setPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectedAccountId = selectedAccount?.id ?? null;

  useEffect(() => {
    if (!selectedAccountId) return;

    let cancelled = false;

    const fetchAccountData = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/dashboard-data?accountId=${selectedAccountId}`,
        );
        const data = await response.json();
        if (cancelled) return;
        if (data.ok) {
          setAccountData(data.accountData);
          setDrafts(data.drafts);
        } else {
          toast.error("ダッシュボードの更新に失敗しました。");
        }
      } catch {
        if (!cancelled) toast.error("ダッシュボードの更新に失敗しました。");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchAccountData();

    // Refresh when the tab regains focus so metrics stay current.
    const handleFocus = () => fetchAccountData();
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
    // `toast` is stable (memoised in ToastProvider).
  }, [selectedAccountId, toast]);

  const handleDelete = useCallback(
    async (draft: DraftDoc) => {
      const ok = await confirm({
        title: "この下書きを削除しますか？",
        description: "削除すると元に戻せません。",
        confirmLabel: "削除する",
        destructive: true,
      });
      if (!ok) return;

      setPending(draft.id, true);
      try {
        const response = await fetch(`/api/drafts/${draft.id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error();
        setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
        toast.success("下書きを削除しました。");
      } catch {
        toast.error("下書きの削除に失敗しました。");
      } finally {
        setPending(draft.id, false);
      }
    },
    [confirm, setPending, toast],
  );

  const handleStatusChange = useCallback(
    async (draft: DraftDoc, status: DraftDoc["status"]) => {
      const previous = draft.status;
      // Optimistic: revert if the request fails.
      setDrafts((prev) =>
        prev.map((item) =>
          item.id === draft.id ? { ...item, status } : item,
        ),
      );
      try {
        const response = await fetch(`/api/drafts/${draft.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!response.ok) throw new Error();
      } catch {
        setDrafts((prev) =>
          prev.map((item) =>
            item.id === draft.id ? { ...item, status: previous } : item,
          ),
        );
        toast.error("ステータスの更新に失敗しました。");
      }
    },
    [toast],
  );

  const handlePublish = useCallback(
    async (draft: DraftDoc) => {
      const ok = await confirm({
        title: "今すぐ投稿しますか？",
        description:
          "この下書きを即座に公開します。投稿後の取り消しはできません。",
        confirmLabel: "投稿する",
      });
      if (!ok) return;

      setPending(draft.id, true);
      try {
        const response = await fetch(`/api/drafts/${draft.id}/publish`, {
          method: "POST",
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message ?? "投稿に失敗しました。");
        }
        setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
        toast.success("投稿しました。");
      } catch (error) {
        toast.error(`投稿に失敗しました: ${(error as Error).message}`);
      } finally {
        setPending(draft.id, false);
      }
    },
    [confirm, setPending, toast],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editingDraft) return;
    setIsSavingEdit(true);
    try {
      const response = await fetch(`/api/drafts/${editingDraft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editedText }),
      });
      if (!response.ok) throw new Error();
      setDrafts((prev) =>
        prev.map((item) =>
          item.id === editingDraft.id
            ? { ...item, text: editedText, updated_at: new Date().toISOString() }
            : item,
        ),
      );
      setEditingDraft(null);
      toast.success("下書きを更新しました。");
    } catch {
      toast.error("下書きの更新に失敗しました。");
    } finally {
      setIsSavingEdit(false);
    }
  }, [editedText, editingDraft, toast]);

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        id: account.id,
        handle: account.handle,
        displayName: account.display_name,
        platform: account.platform,
        autoPostEnabled: account.autoPostEnabled,
      })),
    [accounts],
  );

  const accountLookup = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  const visibleDrafts = useMemo(() => drafts.slice(0, 20), [drafts]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ダッシュボード"
        description="選択中のアカウントの状況、投稿案、パフォーマンスを確認できます。"
        actions={
          <>
            <Link href="/accounts/connect" className={linkButton("primary")}>
              <PlusIcon className="h-4 w-4" />
              アカウントを追加
            </Link>
          </>
        }
      />

      {errors.accountsError ? (
        <EmptyState
          tone="error"
          icon={<AlertIcon className="h-5 w-5" />}
          title="アカウント一覧を読み込めませんでした"
          description="Firebase の認証情報が正しく設定されているか確認してください。"
        />
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          icon={<PlusIcon className="h-5 w-5" />}
          title="まだアカウントが連携されていません"
          description="X または Threads のアカウントを連携し、同期を実行すると分析が始まります。"
          action={
            <Link href="/accounts/connect" className={linkButton()}>
              アカウントを連携する
            </Link>
          }
        />
      ) : (
        <div
          className={
            isLoading ? "pointer-events-none opacity-60 transition-opacity" : ""
          }
        >
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <Stat
                label="RapidAPI 呼び出し数"
                value={initialApiUsage.count.toLocaleString("ja-JP")}
                hint={
                  initialApiUsage.month
                    ? `対象月: ${initialApiUsage.month}`
                    : "対象月: 不明"
                }
              />
              <div className="lg:col-span-2">
                <SyncControls accounts={accountOptions} />
              </div>
            </div>

            <SmartTweetGenerator accounts={accountOptions} />

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>投稿案</CardTitle>
                  <CardDescription>
                    選択中のアカウントの下書きと予約投稿（最新
                    {visibleDrafts.length}件）
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading && drafts.length === 0 ? (
                    <SkeletonList rows={3} />
                  ) : (
                    <DraftList
                      drafts={visibleDrafts}
                      accountLookup={accountLookup}
                      fallbackAccount={selectedAccount}
                      hasError={errors.draftsError}
                      pendingIds={pendingIds}
                      onEdit={(draft) => {
                        setEditingDraft(draft);
                        setEditedText(draft.text);
                      }}
                      onDelete={handleDelete}
                      onPublish={handlePublish}
                      onStatusChange={handleStatusChange}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>アカウント概要</CardTitle>
                  <CardDescription>
                    直近の投稿とパフォーマンス指標
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedAccount ? (
                    <AccountOverview
                      account={selectedAccount}
                      stats={accountData?.stats}
                      recentPosts={accountData?.recentPosts ?? []}
                      hasError={errors.accountDataError}
                      quotaExceeded={errors.quotaExceeded}
                    />
                  ) : (
                    <EmptyState
                      title="アカウントが選択されていません"
                      description="左のサイドバーから運用アカウントを選択してください。"
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={editingDraft !== null}
        onClose={() => setEditingDraft(null)}
        title="下書きを編集"
        description="内容を編集して保存します。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingDraft(null)}>
              キャンセル
            </Button>
            <Button loading={isSavingEdit} onClick={handleSaveEdit}>
              保存する
            </Button>
          </>
        }
      >
        <Textarea
          value={editedText}
          onChange={(event) => setEditedText(event.target.value)}
          className="min-h-[180px]"
          autoFocus
        />
        <p className="mt-2 text-right text-xs text-muted-foreground tabular-nums">
          {editedText.length} 文字
        </p>
      </Modal>
    </div>
  );
}
