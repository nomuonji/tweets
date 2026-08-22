"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { useAccountContext } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { AlertIcon, PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

type AccountOption = {
  id: string;
  handle: string;
  displayName: string;
  platform: "x" | "threads";
  autoPostEnabled?: boolean;
};

type SuggestionResult = {
  tweet: string;
  explanation: string;
};

type ContextPost = {
  id: string;
  text: string;
  score: number;
  impressions: number;
  likes: number;
  reposts: number;
  replies: number;
  source: "top" | "recent";
};

type ExistingDraftSummary = {
  id: string;
  text: string;
  updatedAt?: string;
};

type ExternalContextPost = {
  id: string;
  text: string;
  author_handle: string;
  engagement_rate?: number | null;
  pattern?: { hook: string; structure: string; reaction_reason: string };
};

type PatternStatSummary = {
  structure: string;
  count: number;
  avgEngagementRate: number;
};

type PromoContext = {
  productId: string;
  asin: string;
  title: string;
  url: string;
};

type SmartTweetGeneratorProps = {
  accounts: AccountOption[];
};

const MIN_REFERENCE_POSTS = 6;
const MAX_REFERENCE_POSTS = 40;

export function SmartTweetGenerator({ accounts }: SmartTweetGeneratorProps) {
  const { selectedAccountId, setSelectedAccountId } = useAccountContext();
  const toast = useToast();

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [postLimit, setPostLimit] = useState(15);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [contextPosts, setContextPosts] = useState<ContextPost[]>([]);
  const [existingDrafts, setExistingDrafts] = useState<ExistingDraftSummary[]>(
    [],
  );
  const [externalPosts, setExternalPosts] = useState<ExternalContextPost[]>([]);
  const [patternStats, setPatternStats] = useState<PatternStatSummary[] | null>(
    null,
  );
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [promo, setPromo] = useState<PromoContext | null>(null);
  const [characterVersion, setCharacterVersion] = useState<number | null>(null);

  // Keep the local picker in step with the global account switcher.
  useEffect(() => {
    if (selectedAccountId && selectedAccountId !== accountId) {
      setAccountId(selectedAccountId);
    }
  }, [selectedAccountId, accountId]);

  useEffect(() => {
    if (!selectedAccountId && accountId) setSelectedAccountId(accountId);
  }, [accountId, selectedAccountId, setSelectedAccountId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId),
    [accounts, accountId],
  );

  const handlePreviewPrompt = async () => {
    if (!accountId) {
      setError("アカウントを選択してください。");
      return;
    }
    setPreviewLoading(true);
    setError(null);
    setLastPrompt(null);
    try {
      const response = await fetch("/api/gemini/prepare-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, limit: postLimit }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "プロンプトを生成できませんでした。");
      }
      setLastPrompt(data.prompt as string);
    } catch (previewError) {
      setError((previewError as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!accountId) {
      setError("アカウントを選択してください。");
      return;
    }
    setLoading(true);
    setError(null);
    setSuggestion(null);
    setDuplicateWarning(false);
setContextPosts([]);
    setExistingDrafts([]);
    setExternalPosts([]);
    setPatternStats(null);
    setLastPrompt(null);
    setPromo(null);
    setCharacterVersion(null);
    try {
      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, limit: postLimit }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "投稿案を生成できませんでした。");
      }
      setSuggestion(data.suggestion as SuggestionResult);
      setModelUsed(data.modelUsed as string);
      setContextPosts((data.context?.usedPosts ?? []) as ContextPost[]);
      setExistingDrafts(
        (data.context?.existingDrafts ?? []) as ExistingDraftSummary[],
      );
      setExternalPosts((data.context?.externalPosts ?? []) as ExternalContextPost[]);
      setPatternStats(
        (data.context?.patternStats?.patterns ?? null) as PatternStatSummary[] | null,
      );
      setDuplicateWarning(Boolean(data.duplicate));
      if (data.prompt) setLastPrompt(data.prompt as string);
      if (data.promo) setPromo(data.promo as PromoContext);
      if (Number.isInteger(data.context?.characterVersion)) {
        setCharacterVersion(data.context.characterVersion as number);
      }
    } catch (generateError) {
      setError((generateError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!suggestion || !selectedAccount) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: suggestion.tweet,
          accountId: selectedAccount.id,
          platform: selectedAccount.platform,
          generatedBy: modelUsed,
          characterVersion,
          ...(promo ? { promoProductId: promo.productId, promoProductAsin: promo.asin } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "下書きを保存できませんでした。");
      }
      setExistingDrafts((prev) => [
        {
          id: data.draftId,
          text: suggestion.tweet,
          updatedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setSuggestion(null);
      toast.success("下書きとして保存しました。");
    } catch (saveError) {
      toast.error((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const zone = DateTime.local().zoneName;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 投稿案ジェネレーター</CardTitle>
        <CardDescription>
           外部で伸びている型を見つけ、アカウントのテーマに翻訳して投稿案を生成します。
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              対象アカウント
            </span>
            <Select
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                setSelectedAccountId(event.target.value);
              }}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.handle} · 自動投稿 {account.autoPostEnabled ? "ON" : "OFF"}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              参照する投稿数
            </span>
            <Input
              type="number"
              value={postLimit}
              min={MIN_REFERENCE_POSTS}
              max={MAX_REFERENCE_POSTS}
              onChange={(event) => setPostLimit(Number(event.target.value))}
              className="w-28"
            />
          </label>

          <Button
            loading={loading}
            disabled={previewLoading || accounts.length === 0}
            onClick={handleGenerate}
          >
            {loading ? "生成中..." : "投稿案を生成"}
          </Button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {suggestion ? (
          <div className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-4">
            <div>
              <p className="text-xs font-medium text-success">生成された投稿案</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">
                {suggestion.tweet}
              </p>
              <p className="mt-1.5 text-right text-xs text-muted-foreground tabular-nums">
                {suggestion.tweet.length} 文字
              </p>
            </div>

            <div className="border-t border-dashed border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                この案が有効だと考えられる理由
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {suggestion.explanation}
              </p>
            </div>

            {promo ? (
              <p className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs text-primary">
                この投稿は商品PRです（{promo.asin}）。リンクが本文に含まれていることを確認してから保存してください。
              </p>
            ) : null}

            {duplicateWarning ? (
              <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                既存の下書きと内容が非常に近い可能性があります。
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-2 border-t border-dashed border-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {modelUsed ? (
                  <Badge variant="outline">{modelUsed}</Badge>
                ) : null}
                {promo ? (
                  <Badge variant="primary">PR: {promo.title}</Badge>
                ) : null}
              </div>
              <Button loading={saving} onClick={handleSave}>
                {saving ? null : <PlusIcon className="h-4 w-4" />}
                下書きとして保存
              </Button>
            </div>
          </div>
        ) : null}

        <details className="rounded-lg border border-border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            プロンプトを確認する
          </summary>
          <div className="mt-3 space-y-2">
            <Button
              size="sm"
              variant="outline"
              loading={previewLoading}
              disabled={loading}
              onClick={handlePreviewPrompt}
            >
              {previewLoading ? "生成中..." : "プロンプトを組み立てる"}
            </Button>
            {lastPrompt ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
                {lastPrompt}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                ボタンを押すと、実際に送信されるプロンプトを確認できます。
              </p>
            )}
          </div>
        </details>

        {contextPosts.length > 0 ? (
          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              参照した投稿（{contextPosts.length}件）
            </summary>
            <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {contextPosts.map((post) => (
                <li
                  key={post.id}
                  className="rounded-md border border-border bg-surface p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant={post.source === "top" ? "primary" : "default"}
                    >
                      {post.source === "top" ? "高スコア" : "最近の投稿"}
                    </Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      スコア {post.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-sm">{post.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    <span>表示 {post.impressions.toLocaleString("ja-JP")}</span>
                    <span>いいね {post.likes.toLocaleString("ja-JP")}</span>
                    <span>リポスト {post.reposts.toLocaleString("ja-JP")}</span>
                    <span>返信 {post.replies.toLocaleString("ja-JP")}</span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {externalPosts.length > 0 ? (
          <details className="rounded-lg border border-primary/20 bg-primary/5 p-3" open>
            <summary className="cursor-pointer text-sm font-medium text-primary">
              生成に使った外部の勝ち筋（{externalPosts.length}件）
            </summary>
            <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {externalPosts.map((post) => (
                <li key={post.id} className="rounded-md border border-border bg-surface p-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>@{post.author_handle}</span>
                    {post.pattern ? <span>{post.pattern.structure}</span> : null}
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-sm">{post.text}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {patternStats && patternStats.length > 0 ? (
          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              このアカウントの型別成績（自己改善データ）
            </summary>
            <ul className="mt-3 space-y-1.5">
              {patternStats.slice(0, 6).map((stat) => (
                <li
                  key={stat.structure}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">{stat.structure}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {stat.count}投稿・{(stat.avgEngagementRate * 100).toFixed(2)}%
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {existingDrafts.length > 0 ? (
          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              重複チェックに使った既存の下書き（{existingDrafts.length}件）
            </summary>
            <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto">
              {existingDrafts.map((draft) => {
                const updated = draft.updatedAt
                  ? DateTime.fromISO(draft.updatedAt)
                  : null;
                return (
                  <li
                    key={draft.id}
                    className="rounded-md border border-border bg-surface p-2.5"
                  >
                    <p className="line-clamp-2 text-sm">{draft.text}</p>
                    {updated?.isValid ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        更新 {updated.setZone(zone).toFormat("M/d HH:mm")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
