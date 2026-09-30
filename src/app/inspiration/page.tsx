"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  InspirationAccountDoc,
  InspirationPlatform,
  InspirationWatchPriority,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";

const platforms: { value: InspirationPlatform; label: string }[] = [
  { value: "x", label: "X" },
  { value: "threads", label: "Threads" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "other", label: "その他" },
];

const priorities: { value: InspirationWatchPriority; label: string }[] = [
  { value: "high", label: "高" },
  { value: "normal", label: "通常" },
  { value: "low", label: "低" },
];

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function InspirationAccountsPage() {
  const toast = useToast();
  const [items, setItems] = useState<InspirationAccountDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<InspirationPlatform>("x");
  const [handle, setHandle] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [whyUseful, setWhyUseful] = useState("");
  const [tags, setTags] = useState("");
  const [themes, setThemes] = useState("");
  const [targetAccountIds, setTargetAccountIds] = useState("");
  const [priority, setPriority] =
    useState<InspirationWatchPriority>("normal");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/inspiration-accounts");
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "読み込みに失敗しました。");
      setItems(data.items);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [
        item.handle,
        item.display_name,
        item.why_useful,
        item.notes,
        ...(item.tags ?? []),
        ...(item.themes ?? []),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  const activeCount = items.filter((item) => item.status === "active").length;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/inspiration-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          handle,
          profile_url: profileUrl,
          why_useful: whyUseful,
          tags: splitCsv(tags),
          themes: splitCsv(themes),
          target_account_ids: splitCsv(targetAccountIds),
          watch_priority: priority,
          status: "active",
          source: "ui",
        }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "保存に失敗しました。");
      toast.success(`@${data.account.handle} を参考アカウントに追加しました。`);
      setHandle("");
      setProfileUrl("");
      setWhyUseful("");
      setTags("");
      setThemes("");
      setTargetAccountIds("");
      setPriority("normal");
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function archive(item: InspirationAccountDoc) {
    try {
      const response = await fetch(`/api/inspiration-accounts/${item.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: item.updated_at }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "アーカイブに失敗しました。");
      setItems((current) =>
        current.map((value) => (value.id === item.id ? data.account : value)),
      );
      toast.success(`@${item.handle} をアーカイブしました。`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="参考SNSアカウント"
        description="投稿の型・テーマ・企画の参考にしたい外部アカウントを、プラットフォーム横断で蓄積するプールです。X自動同期用 reference_accounts とは分離されています。"
      />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>アカウントを追加</CardTitle>
            <CardDescription>
              後からMCP経由でエージェントが一覧・追加・更新・調査対象選定できます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
              <Field label="SNS">
                {(id) => (
                  <Select
                    id={id}
                    value={platform}
                    onChange={(event) =>
                      setPlatform(event.target.value as InspirationPlatform)
                    }
                  >
                    {platforms.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="ハンドル">
                {(id) => (
                  <Input
                    id={id}
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="@example"
                    required
                  />
                )}
              </Field>
              <Field label="プロフィールURL">
                {(id) => (
                  <Input
                    id={id}
                    type="url"
                    value={profileUrl}
                    onChange={(event) => setProfileUrl(event.target.value)}
                    placeholder="https://..."
                  />
                )}
              </Field>
              <Field label="監視頻度">
                {(id) => (
                  <Select
                    id={id}
                    value={priority}
                    onChange={(event) =>
                      setPriority(
                        event.target.value as InspirationWatchPriority,
                      )
                    }
                  >
                    {priorities.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="タグ" hint="カンマ区切り。例: SEO, 恋愛, フック">
                {(id) => (
                  <Input
                    id={id}
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                  />
                )}
              </Field>
              <Field label="テーマ" hint="カンマ区切り。投稿内容の領域。">
                {(id) => (
                  <Input
                    id={id}
                    value={themes}
                    onChange={(event) => setThemes(event.target.value)}
                  />
                )}
              </Field>
              <Field
                label="紐付ける自分のアカウントID"
                hint="任意。カンマ区切り。MCPの絞り込みに使えます。"
                className="md:col-span-2"
              >
                {(id) => (
                  <Input
                    id={id}
                    value={targetAccountIds}
                    onChange={(event) => setTargetAccountIds(event.target.value)}
                  />
                )}
              </Field>
              <Field
                label="なぜ参考になるか"
                hint="エージェントが後から見ても判断できる理由を残します。"
                className="md:col-span-2"
              >
                {(id) => (
                  <Textarea
                    id={id}
                    value={whyUseful}
                    onChange={(event) => setWhyUseful(event.target.value)}
                    placeholder="例: 専門情報を短いフックに落とす型がうまい。最近のSEO一次情報の拾い方を定期確認したい。"
                  />
                )}
              </Field>
              <div className="md:col-span-2">
                <Button type="submit" loading={saving}>
                  プールに追加
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>プール状況</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">全件</p>
              <p className="text-2xl font-semibold tabular-nums">{items.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">アクティブ</p>
              <p className="text-2xl font-semibold tabular-nums">{activeCount}</p>
            </div>
            <Field label="絞り込み">
              {(id) => (
                <Input
                  id={id}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="handle / タグ / メモ"
                />
              )}
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>保存済みアカウント</CardTitle>
          <CardDescription>
            アーカイブ済みも履歴として残ります。削除はしません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          ) : visibleItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              条件に合う参考アカウントはありません。
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {visibleItems.map((item) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-border bg-background p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold">@{item.handle}</h3>
                        <Badge variant={item.status === "active" ? "success" : "outline"}>
                          {item.status}
                        </Badge>
                        <Badge variant="outline">{item.platform}</Badge>
                        {item.watch_priority === "high" ? (
                          <Badge variant="warning">高優先度</Badge>
                        ) : null}
                      </div>
                      {item.why_useful ? (
                        <p className="mt-2 text-sm text-foreground">
                          {item.why_useful}
                        </p>
                      ) : null}
                    </div>
                    {item.status !== "archived" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => archive(item)}
                      >
                        アーカイブ
                      </Button>
                    ) : null}
                  </div>

                  {(item.tags?.length ?? 0) > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <Badge key={tag} variant="primary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {item.profile_url ? (
                      <a
                        href={item.profile_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        プロフィールを開く
                      </a>
                    ) : null}
                    <span>
                      最終確認: {item.last_reviewed_at ? item.last_reviewed_at.slice(0, 10) : "未確認"}
                    </span>
                    {(item.target_account_ids?.length ?? 0) > 0 ? (
                      <span>対象: {item.target_account_ids.join(", ")}</span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
