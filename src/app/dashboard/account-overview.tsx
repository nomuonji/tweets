"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import type { AccountDoc, PostDoc } from "@/lib/types";
import { platformLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/page-header";
import { AlertIcon, ExternalLinkIcon, InboxIcon } from "@/components/ui/icons";

type AccountOverviewProps = {
  account: AccountDoc;
  stats: { postCount: number; bestPost: PostDoc | null } | undefined;
  recentPosts: PostDoc[];
  hasError: boolean;
  quotaExceeded: boolean;
};

function formatNumber(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("ja-JP");
}

function MetricPills({ post }: { post: PostDoc }) {
  const metrics: Array<[string, number | null | undefined]> = [
    ["表示", post.metrics.impressions],
    ["いいね", post.metrics.likes],
    ["リポスト", post.metrics.reposts_or_rethreads],
    ["返信", post.metrics.replies],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {metrics.map(([label, value]) => (
        <span
          key={label}
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          {label} {formatNumber(value)}
        </span>
      ))}
    </div>
  );
}

export function AccountOverview({
  account,
  stats,
  recentPosts,
  hasError,
  quotaExceeded,
}: AccountOverviewProps) {
  const zone = DateTime.local().zoneName;
  const bestPost = stats?.bestPost ?? null;
  const lastSync = account.sync_cursor
    ? DateTime.fromISO(account.sync_cursor)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {platformLabel(account.platform)}
          </p>
          <h2 className="truncate text-lg font-semibold">@{account.handle}</h2>
          {account.display_name ? (
            <p className="truncate text-sm text-muted-foreground">
              {account.display_name}
            </p>
          ) : null}
        </div>
        <Badge variant={account.connected ? "success" : "default"}>
          {account.connected ? "接続中" : "未接続"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="投稿数" value={formatNumber(stats?.postCount)} />
        <Stat
          label="最終同期"
          value={
            <span className="text-base">
              {lastSync?.isValid
                ? lastSync.setZone(zone).toFormat("M/d HH:mm")
                : "—"}
            </span>
          }
        />
        <Stat
          label="最高スコア"
          value={bestPost ? bestPost.score.toFixed(2) : "—"}
        />
      </div>

      {quotaExceeded ? (
        <EmptyState
          tone="error"
          icon={<AlertIcon className="h-5 w-5" />}
          title="Firestore の読み取り上限に達しました"
          description="上限がリセットされるまで、このアカウントの投稿は表示できません。"
        />
      ) : hasError ? (
        <EmptyState
          tone="error"
          icon={<AlertIcon className="h-5 w-5" />}
          title="投稿を読み込めませんでした"
          description="Firebase の設定とサーバーログを確認してください。"
        />
      ) : (
        <>
          {bestPost ? (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">最もスコアの高い投稿</h3>
              <Link
                href={bestPost.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary"
              >
                <p className="line-clamp-3 text-sm">{bestPost.text}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <MetricPills post={bestPost} />
                  <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </div>
              </Link>
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">最近の投稿</h3>
            {recentPosts.length === 0 ? (
              <EmptyState
                icon={<InboxIcon className="h-5 w-5" />}
                title="投稿がまだありません"
                description="同期を実行すると、ここに直近の投稿が表示されます。"
              />
            ) : (
              <ul className="space-y-2">
                {recentPosts.map((post) => {
                  const createdAt = DateTime.fromISO(post.created_at);
                  return (
                    <li
                      key={post.id}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <p className="line-clamp-2 text-sm">{post.text}</p>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {createdAt.isValid
                            ? createdAt.setZone(zone).toFormat("M/d HH:mm")
                            : "—"}
                        </span>
                        <span className="tabular-nums">
                          スコア {post.score.toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-2">
                        <MetricPills post={post} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
