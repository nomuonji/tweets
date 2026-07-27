"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import type { PostDoc, RankingFilter } from "@/lib/types";
import { platformLabel } from "@/lib/utils";
import { MEDIA_TYPE_LABELS } from "@/lib/labels";
import { useAccountContext } from "@/components/account/account-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  ExternalLinkIcon,
  InboxIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

interface RankingClientProps {
  initialPosts: PostDoc[];
  filters: Omit<RankingFilter, "accountId"> & { sort: "top" | "latest" };
}

function formatMetric(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("ja-JP");
}

export function RankingClient({ initialPosts, filters }: RankingClientProps) {
  const { selectedAccount } = useAccountContext();
  const toast = useToast();
  const confirm = useConfirm();

  const [posts, setPosts] = useState(initialPosts);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const accountId = selectedAccount?.id ?? null;

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    const fetchRankingData = async () => {
      setIsLoading(true);
      const params = new URLSearchParams({
        platform: filters.platform,
        media: filters.media_type,
        period: String(filters.period_days),
        sort: filters.sort,
        accountId,
      });

      try {
        const response = await fetch(`/api/ranking-data?${params.toString()}`);
        const data = await response.json();
        if (cancelled) return;
        if (data.ok) setPosts(data.posts);
        else toast.error("ランキングの取得に失敗しました。");
      } catch {
        if (!cancelled) toast.error("ランキングの取得に失敗しました。");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchRankingData();
    return () => {
      cancelled = true;
    };
  }, [accountId, filters, toast]);

  const handleDelete = async (post: PostDoc) => {
    const ok = await confirm({
      title: "この投稿をデータベースから削除しますか？",
      description:
        "分析データから削除されます。SNS 上の実際の投稿は削除されません。",
      confirmLabel: "削除する",
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(post.id);
    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? "削除に失敗しました。");
      }
      setPosts((prev) => prev.filter((item) => item.id !== post.id));
      toast.success("投稿を削除しました。");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading && posts.length === 0) {
    return <SkeletonList rows={4} />;
  }

  if (posts.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon className="h-5 w-5" />}
        title="条件に合う投稿がありません"
        description="フィルターを変更するか、同期を実行して投稿を取り込んでください。"
      />
    );
  }

  const zone = DateTime.local().zoneName;

  return (
    <div
      className={
        isLoading ? "pointer-events-none opacity-60 transition-opacity" : ""
      }
    >
      {/* Cards on small screens, table from lg up — the metric table is too
          wide to read on a phone. */}
      <div className="space-y-3 lg:hidden">
        {posts.map((post, index) => (
          <Card key={post.id}>
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={index < 3 ? "primary" : "default"}>
                    {index + 1}位
                  </Badge>
                  <Badge variant="outline">
                    {platformLabel(post.platform)}
                  </Badge>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {post.score.toFixed(2)}
                </span>
              </div>
              <p className="line-clamp-4 text-sm">{post.text}</p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["表示", post.metrics.impressions],
                    ["いいね", post.metrics.likes],
                    ["リポスト", post.metrics.reposts_or_rethreads],
                    ["返信", post.metrics.replies],
                  ] as Array<[string, number | null | undefined]>
                ).map(([label, value]) => (
                  <span
                    key={label}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                  >
                    {label} {formatMetric(value)}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-xs text-muted-foreground">
                  {DateTime.fromISO(post.created_at)
                    .setZone(zone)
                    .toFormat("yyyy/MM/dd HH:mm")}
                </span>
                <div className="flex items-center gap-1">
                  {post.url ? (
                    <Link
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLinkIcon className="h-3.5 w-3.5" />
                      開く
                    </Link>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={deletingId === post.id}
                    onClick={() => handleDelete(post)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    削除
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden overflow-hidden lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  #
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  投稿
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  種別
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  投稿日時
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  スコア
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  表示
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  いいね
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  リポスト
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  返信
                </th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {posts.map((post, index) => (
                <tr key={post.id} className="transition-colors hover:bg-surface-hover">
                  <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <p className="line-clamp-2">{post.text}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline">
                        {platformLabel(post.platform)}
                      </Badge>
                      {post.url ? (
                        <Link
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLinkIcon className="h-3 w-3" />
                          開く
                        </Link>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {MEDIA_TYPE_LABELS[post.media_type] ?? post.media_type}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {DateTime.fromISO(post.created_at)
                      .setZone(zone)
                      .toFormat("yyyy/MM/dd HH:mm")}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {post.score.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMetric(post.metrics.impressions)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMetric(post.metrics.likes)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMetric(post.metrics.reposts_or_rethreads)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMetric(post.metrics.replies)}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="この投稿を削除"
                      loading={deletingId === post.id}
                      onClick={() => handleDelete(post)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {deletingId === post.id ? null : (
                        <TrashIcon className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
