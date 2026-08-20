"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Tip, AccountDoc, Platform } from "@/lib/types";
import { platformLabel, sortAccountsByAutoPost } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, linkButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  AlertIcon,
  ExternalLinkIcon,
  LightbulbIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

export default function TipsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [tips, setTips] = useState<Tip[]>([]);
  const [accounts, setAccounts] = useState<AccountDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [postUrl, setPostUrl] = useState("");
  const [isFetchingPost, setIsFetchingPost] = useState(false);
  const [currentTip, setCurrentTip] = useState<Partial<Tip> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTipsAndAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const [tipsResponse, accountsResponse] = await Promise.all([
        fetch("/api/tips"),
        fetch("/api/accounts"),
      ]);
      const tipsData = await tipsResponse.json();
      const accountsData = await accountsResponse.json();

      if (!tipsData.ok) {
        throw new Error(tipsData.message || "Tips を取得できませんでした。");
      }
      if (!accountsData.ok) {
        throw new Error(
          accountsData.message || "アカウントを取得できませんでした。",
        );
      }

      setTips(tipsData.tips);
      setAccounts(sortAccountsByAutoPost(accountsData.accounts));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTipsAndAccounts();
    const handleFocus = () => fetchTipsAndAccounts();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchTipsAndAccounts]);

  /** Which accounts currently reference each tip. */
  const usersByTip = useMemo(() => {
    const map = new Map<string, AccountDoc[]>();
    tips.forEach((tip) => {
      map.set(
        tip.id,
        accounts.filter((account) => account.selectedTipIds?.includes(tip.id)),
      );
    });
    return map;
  }, [tips, accounts]);

  const handleFetchPost = async () => {
    if (!postUrl.trim()) return;
    setIsFetchingPost(true);
    try {
      const response = await fetch("/api/scrape-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: postUrl }),
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.message || "投稿を取得できませんでした。");
      }

      const { post } = data;
      setCurrentTip({
        url: post.url,
        platform: post.platform,
        author_handle: post.author_handle,
        text: post.text,
        title: post.text.substring(0, 40),
        account_ids: [],
      });
      setPostUrl("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsFetchingPost(false);
    }
  };

  const handleEdit = (tip: Tip) => {
    setCurrentTip({
      ...tip,
      account_ids: (usersByTip.get(tip.id) ?? []).map((account) => account.id),
    });
  };

  const handleDelete = async (tip: Tip) => {
    const ok = await confirm({
      title: "この参考投稿を削除しますか？",
      description: "削除すると元に戻せません。",
      confirmLabel: "削除する",
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(tip.id);
    try {
      const response = await fetch(`/api/tips/${tip.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "削除に失敗しました。");
      await fetchTipsAndAccounts();
      toast.success("参考投稿を削除しました。");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentTip) return;

    setIsSaving(true);
    try {
      // `account_ids` is a UI-only association; it is persisted on each account
      // in step 2 rather than on the tip document.
      const { account_ids: desiredIds = [], ...tipData } = currentTip;

      const isNewTip = !currentTip.id;
      const tipResponse = await fetch(
        isNewTip ? "/api/tips" : `/api/tips/${currentTip.id}`,
        {
          method: isNewTip ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tipData),
        },
      );
      const tipResult = await tipResponse.json();
      if (!tipResult.ok) {
        throw new Error(tipResult.message || "保存に失敗しました。");
      }

      const savedTipId = tipResult.tip.id;
      const desired = new Set(desiredIds);

      // Only PATCH accounts whose association actually changed.
      const updates = accounts
        .map((account) => {
          const tipIds = new Set(account.selectedTipIds ?? []);
          const hasTip = tipIds.has(savedTipId);
          const wantsTip = desired.has(account.id);
          if (hasTip === wantsTip) return null;

          if (wantsTip) tipIds.add(savedTipId);
          else tipIds.delete(savedTipId);

          return fetch(`/api/accounts/${account.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedTipIds: Array.from(tipIds) }),
          });
        })
        .filter((item): item is Promise<Response> => item !== null);

      await Promise.all(updates);

      setCurrentTip(null);
      await fetchTipsAndAccounts();
      toast.success("参考投稿を保存しました。");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAccount = (accountId: string) => {
    setCurrentTip((prev) => {
      if (!prev) return prev;
      const ids = prev.account_ids ?? [];
      return {
        ...prev,
        account_ids: ids.includes(accountId)
          ? ids.filter((id) => id !== accountId)
          : [...ids, accountId],
      };
    });
  };

  // --- Editor view -----------------------------------------------------------
  if (currentTip) {
    const isLinked = Boolean(currentTip.url);
    return (
      <div className="space-y-6">
        <PageHeader
          title={currentTip.id ? "参考投稿を編集" : "参考投稿を追加"}
          description="投稿生成のプロンプトに含める参考テキストを設定します。"
        />

        <Card>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <Field label="本文" hint="この内容がプロンプトに含まれます。">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={6}
                    required
                    value={currentTip.text ?? ""}
                    onChange={(event) =>
                      setCurrentTip({ ...currentTip, text: event.target.value })
                    }
                  />
                )}
              </Field>

              <Field label="タイトル" hint="一覧での識別に使われます。">
                {(id) => (
                  <Input
                    id={id}
                    value={currentTip.title ?? ""}
                    placeholder="例: 冒頭で結論を出す型"
                    onChange={(event) =>
                      setCurrentTip({ ...currentTip, title: event.target.value })
                    }
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="投稿者のハンドル"
                  hint={isLinked ? "URL から取得済みのため編集できません。" : undefined}
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={currentTip.author_handle ?? ""}
                      disabled={isLinked}
                      onChange={(event) =>
                        setCurrentTip({
                          ...currentTip,
                          author_handle: event.target.value,
                        })
                      }
                    />
                  )}
                </Field>

                <Field
                  label="プラットフォーム"
                  hint={isLinked ? "URL から取得済みのため編集できません。" : undefined}
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={currentTip.platform ?? ""}
                      disabled={isLinked}
                      onChange={(event) =>
                        setCurrentTip({
                          ...currentTip,
                          platform: event.target.value as Platform,
                        })
                      }
                    >
                      <option value="">選択してください</option>
                      <option value="x">X</option>
                      <option value="threads">Threads</option>
                    </Select>
                  )}
                </Field>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">使用するアカウント</p>
                {accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    連携済みのアカウントがありません。
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {accounts.map((account) => (
                      <Checkbox
                        key={account.id}
                        label={`@${account.handle}`}
                        description={`${platformLabel(account.platform)} · 自動投稿 ${account.autoPostEnabled ? "ON" : "OFF"}`}
                        checked={
                          currentTip.account_ids?.includes(account.id) ?? false
                        }
                        onChange={() => toggleAccount(account.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCurrentTip(null)}
                >
                  キャンセル
                </Button>
                <Button type="submit" loading={isSaving}>
                  保存する
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- List view -------------------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tips（参考投稿）"
        description="伸びた投稿や参考にしたい型を登録し、アカウントごとに使い分けられます。"
        actions={
          <Button onClick={() => setCurrentTip({ text: "", account_ids: [] })}>
            <PlusIcon className="h-4 w-4" />
            手動で追加
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-2">
          <Field
            label="URL から追加"
            hint="X / Threads の投稿 URL を貼り付けると、本文を自動で取り込みます。"
          >
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  type="url"
                  value={postUrl}
                  placeholder="https://x.com/user/status/..."
                  onChange={(event) => setPostUrl(event.target.value)}
                />
                <Button
                  loading={isFetchingPost}
                  disabled={!postUrl.trim()}
                  onClick={handleFetchPost}
                >
                  取り込む
                </Button>
              </div>
            )}
          </Field>
        </CardContent>
      </Card>

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : error ? (
        <EmptyState
          tone="error"
          icon={<AlertIcon className="h-5 w-5" />}
          title="Tips を読み込めませんでした"
          description={error}
          action={
            <Button variant="outline" onClick={fetchTipsAndAccounts}>
              再試行
            </Button>
          }
        />
      ) : tips.length === 0 ? (
        <EmptyState
          icon={<LightbulbIcon className="h-5 w-5" />}
          title="参考投稿がまだありません"
          description="上の URL 入力欄から取り込むか、手動で追加してください。"
        />
      ) : (
        <div className="space-y-3">
          {tips.map((tip) => {
            const users = usersByTip.get(tip.id) ?? [];
            return (
              <Card key={tip.id}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {tip.title ? (
                      <h2 className="text-sm font-semibold">{tip.title}</h2>
                    ) : null}
                    {tip.platform ? (
                      <Badge variant="outline">
                        {platformLabel(tip.platform)}
                      </Badge>
                    ) : null}
                    {tip.author_handle ? (
                      <span className="text-xs text-muted-foreground">
                        @{tip.author_handle}
                      </span>
                    ) : null}
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {tip.text}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      使用中:
                    </span>
                    {users.length > 0 ? (
                      users.map((account) => (
                        <Badge key={account.id} variant="primary">
                          @{account.handle}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        どのアカウントでも未使用
                      </span>
                    )}
                  </div>

                  <div className="flex justify-end gap-1 border-t border-border pt-3">
                    {tip.url ? (
                      <a
                        href={tip.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkButton("ghost", "sm")}
                      >
                        <ExternalLinkIcon className="h-3.5 w-3.5" />
                        元の投稿
                      </a>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(tip)}
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      編集
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={deletingId === tip.id}
                      onClick={() => handleDelete(tip)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {deletingId === tip.id ? null : (
                        <TrashIcon className="h-3.5 w-3.5" />
                      )}
                      削除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
