"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { AccountDoc, DraftDoc, PostDoc, PostMetrics } from "@/lib/types";
import { cn, platformLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { AlertIcon, CalendarIcon, InboxIcon } from "@/components/ui/icons";

interface ScheduleData {
  scheduledDrafts: DraftDoc[];
  recentPosts: PostDoc[];
  accounts: AccountDoc[];
}

/** Left-border colours used to tell accounts apart at a glance. */
const ACCENTS = [
  "border-l-blue-500",
  "border-l-emerald-500",
  "border-l-pink-500",
  "border-l-amber-500",
  "border-l-violet-500",
  "border-l-cyan-500",
  "border-l-rose-500",
  "border-l-lime-500",
];

function MetricsRow({ metrics }: { metrics: PostMetrics }) {
  const items: Array<[string, number | null | undefined]> = [
    ["いいね", metrics.likes],
    ["返信", metrics.replies],
    ["リポスト", metrics.reposts_or_rethreads],
    ["表示", metrics.impressions],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items
        .filter(([, value]) => value != null)
        .map(([label, value]) => (
          <span
            key={label}
            className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {label} {(value as number).toLocaleString("ja-JP")}
          </span>
        ))}
    </div>
  );
}

export default function SchedulePage() {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSchedule() {
      try {
        setIsLoading(true);
        const response = await fetch("/api/schedule");
        const result = await response.json();
        if (cancelled) return;
        if (!result.ok) {
          throw new Error(result.message || "スケジュールを取得できませんでした。");
        }
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchSchedule();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountMap = useMemo(
    () => new Map(data?.accounts.map((account) => [account.id, account]) ?? []),
    [data],
  );

  const accentMap = useMemo(() => {
    const map = new Map<string, string>();
    data?.accounts.forEach((account, index) => {
      map.set(account.id, ACCENTS[index % ACCENTS.length]);
    });
    return map;
  }, [data]);

  const zone = DateTime.local().zoneName;

  const renderItem = (item: DraftDoc | PostDoc, isDraft: boolean) => {
    const accountId = isDraft
      ? ((item as DraftDoc).target_account_id ?? "")
      : (item as PostDoc).account_id;
    const account = accountMap.get(accountId);
    const iso = isDraft
      ? (item as DraftDoc).schedule_time
      : (item as PostDoc).created_at;
    const time = iso ? DateTime.fromISO(iso) : null;

    return (
      <li
        key={item.id}
        className={cn(
          "space-y-2.5 rounded-lg border border-l-4 border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md",
          accentMap.get(accountId) ?? "border-l-border",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">
            {account ? `@${account.handle}` : "不明なアカウント"}
          </span>
          {account ? (
            <Badge variant="outline">{platformLabel(account.platform)}</Badge>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {item.text}
        </p>
        {!isDraft ? <MetricsRow metrics={(item as PostDoc).metrics} /> : null}
        <p className="text-right text-xs text-muted-foreground">
          {time?.isValid
            ? time.setZone(zone).toFormat("yyyy/MM/dd HH:mm")
            : "日時未設定"}
        </p>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="投稿スケジュール"
        description="全アカウントの予約投稿と、直近24時間の投稿実績をまとめて確認できます。"
      />

      {error ? (
        <EmptyState
          tone="error"
          icon={<AlertIcon className="h-5 w-5" />}
          title="スケジュールを読み込めませんでした"
          description={error}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>予約中の投稿</CardTitle>
              <CardDescription>
                ステータスが「予約済み」の下書きが表示されます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <SkeletonList rows={3} />
              ) : data?.scheduledDrafts.length ? (
                <ul className="space-y-3">
                  {data.scheduledDrafts.map((draft) => renderItem(draft, true))}
                </ul>
              ) : (
                <EmptyState
                  icon={<CalendarIcon className="h-5 w-5" />}
                  title="予約中の投稿はありません"
                  description="ダッシュボードで下書きのステータスを「予約済み」にすると、ここに表示されます。"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>直近24時間の投稿</CardTitle>
              <CardDescription>
                実際に公開された投稿と、その反応が表示されます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <SkeletonList rows={3} />
              ) : data?.recentPosts.length ? (
                <ul className="space-y-3">
                  {data.recentPosts.map((post) => renderItem(post, false))}
                </ul>
              ) : (
                <EmptyState
                  icon={<InboxIcon className="h-5 w-5" />}
                  title="直近24時間の投稿はありません"
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
