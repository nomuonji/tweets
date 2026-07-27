"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import type { AccountDoc, Tip } from "@/lib/types";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  findNextSlot,
} from "@/lib/services/schedule-slots";
import { platformLabel } from "@/lib/utils";
import { TipsSelectionModal } from "@/components/tips-selection-modal";
import { Badge } from "@/components/ui/badge";
import { Button, linkButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { ScheduleEditor } from "@/components/schedule/schedule-editor";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { AlertIcon, PlusIcon, UsersIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Editable per-account settings, held in React state rather than read off the DOM. */
type SettingsDraft = {
  concept: string;
  autoPostEnabled: boolean;
  postSchedule: string[];
};

function toSettingsDraft(account: AccountDoc): SettingsDraft {
  return {
    concept: account.concept ?? "",
    autoPostEnabled: account.autoPostEnabled ?? false,
    postSchedule: account.postSchedule ?? [],
  };
}

/** At-a-glance auto-post state, so "why didn't it post?" is answerable here. */
function ScheduleSummary({ account }: { account: AccountDoc }) {
  const schedule = account.postSchedule ?? [];

  if (!account.autoPostEnabled) {
    return (
      <p className="text-xs text-muted-foreground">自動投稿はオフです。</p>
    );
  }

  if (schedule.length === 0) {
    return (
      <p className="text-xs text-warning">
        自動投稿はオンですが、投稿時刻が未設定のため実行されません。
      </p>
    );
  }

  const next = findNextSlot(
    schedule,
    DateTime.now().setZone(DEFAULT_SCHEDULE_TIMEZONE),
  );

  return (
    <p className="text-xs text-muted-foreground">
      投稿時刻 {[...schedule].sort().join(" / ")}
      {next ? ` ・ 次回 ${next.toFormat("M/d HH:mm")}` : ""}
    </p>
  );
}

export default function AccountsIndexPage() {
  const toast = useToast();

  const [accounts, setAccounts] = useState<AccountDoc[]>([]);
  const [allTips, setAllTips] = useState<Tip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [tipsTarget, setTipsTarget] = useState<AccountDoc | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [accountsRes, tipsRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/tips"),
      ]);
      const accountsData = await accountsRes.json();
      const tipsData = await tipsRes.json();

      if (!accountsData.ok) {
        throw new Error(accountsData.message || "アカウントを取得できませんでした。");
      }
      if (!tipsData.ok) {
        throw new Error(tipsData.message || "Tips を取得できませんでした。");
      }

      setAccounts(
        [...accountsData.accounts].sort((a: AccountDoc, b: AccountDoc) =>
          a.handle.localeCompare(b.handle),
        ),
      );
      setAllTips(tipsData.tips);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startEditing = (account: AccountDoc) => {
    if (editingId === account.id) {
      setEditingId(null);
      setSettingsDraft(null);
      return;
    }
    setEditingId(account.id);
    setSettingsDraft(toSettingsDraft(account));
  };

  const handleSaveTips = async (updatedTipIds: string[]) => {
    if (!tipsTarget) return;
    try {
      const response = await fetch(`/api/accounts/${tipsTarget.id}/tips`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedTipIds: updatedTipIds }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "Tips を更新できませんでした。");

      setAccounts((prev) =>
        prev.map((account) =>
          account.id === tipsTarget.id
            ? { ...account, selectedTipIds: updatedTipIds }
            : account,
        ),
      );
      setTipsTarget(null);
      toast.success("Tips の設定を保存しました。");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleSaveSettings = async (accountId: string) => {
    if (!settingsDraft) return;
    setIsSaving(true);

    const payload = {
      concept: settingsDraft.concept,
      autoPostEnabled: settingsDraft.autoPostEnabled,
      postSchedule: settingsDraft.postSchedule.filter(Boolean).sort(),
    };

    try {
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || "設定を更新できませんでした。");

      setAccounts((prev) =>
        prev.map((account) =>
          account.id === accountId ? { ...account, ...payload } : account,
        ),
      );
      setEditingId(null);
      setSettingsDraft(null);
      toast.success("設定を保存しました。");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="アカウント"
        description="接続状況、コンセプト、自動投稿スケジュール、生成に使う Tips を設定できます。"
        actions={
          <Link href="/accounts/connect" className={linkButton()}>
            <PlusIcon className="h-4 w-4" />
            アカウントを連携
          </Link>
        }
      />

      {tipsTarget ? (
        <TipsSelectionModal
          account={tipsTarget}
          allTips={allTips}
          onClose={() => setTipsTarget(null)}
          onSave={handleSaveTips}
        />
      ) : null}

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : error ? (
        <EmptyState
          tone="error"
          icon={<AlertIcon className="h-5 w-5" />}
          title="アカウントを読み込めませんでした"
          description={error}
          action={
            <Button variant="outline" onClick={fetchData}>
              再試行
            </Button>
          }
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-5 w-5" />}
          title="接続済みのアカウントがありません"
          description="X または Threads のアカウントを連携すると、ここに表示されます。"
          action={
            <Link href="/accounts/connect" className={linkButton()}>
              アカウントを連携する
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const isEditing = editingId === account.id;
            return (
              <Card key={account.id}>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">
                          @{account.handle}
                        </h2>
                        <Badge variant="outline">
                          {platformLabel(account.platform)}
                        </Badge>
                        <Badge
                          variant={account.connected ? "success" : "default"}
                        >
                          {account.connected ? "接続中" : "未接続"}
                        </Badge>
                        {account.autoPostEnabled ? (
                          <Badge variant="primary">自動投稿 ON</Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {account.concept || "コンセプト未設定"}
                      </p>
                      <ScheduleSummary account={account} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={isEditing ? "secondary" : "outline"}
                        onClick={() => startEditing(account)}
                      >
                        {isEditing ? "設定を閉じる" : "設定"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTipsTarget(account)}
                      >
                        Tips ({account.selectedTipIds?.length ?? 0})
                      </Button>
                      <Link
                        href={`/accounts/connect?handle=${encodeURIComponent(account.handle)}`}
                        className={linkButton("outline", "sm")}
                      >
                        接続を更新
                      </Link>
                    </div>
                  </div>

                  {isEditing && settingsDraft ? (
                    <div className="space-y-4 border-t border-border pt-4">
                      <Field
                        label="コンセプト"
                        hint="このアカウントの方向性を書くと、生成される投稿の内容に反映されます。"
                      >
                        {(id) => (
                          <Textarea
                            id={id}
                            rows={3}
                            value={settingsDraft.concept}
                            onChange={(event) =>
                              setSettingsDraft((prev) =>
                                prev
                                  ? { ...prev, concept: event.target.value }
                                  : prev,
                              )
                            }
                          />
                        )}
                      </Field>

                      <Checkbox
                        label="自動投稿を有効にする"
                        description="下のスケジュール時刻に、下書きが自動で投稿されます。"
                        checked={settingsDraft.autoPostEnabled}
                        onChange={(event) =>
                          setSettingsDraft((prev) =>
                            prev
                              ? { ...prev, autoPostEnabled: event.target.checked }
                              : prev,
                          )
                        }
                      />

                      <div className="space-y-2">
                        <p className="text-sm font-medium">投稿スケジュール</p>
                        <ScheduleEditor
                          value={settingsDraft.postSchedule}
                          onChange={(next) =>
                            setSettingsDraft((prev) =>
                              prev ? { ...prev, postSchedule: next } : prev,
                            )
                          }
                          copySources={accounts
                            .filter((item) => item.id !== account.id)
                            .map((item) => ({
                              id: item.id,
                              label: `@${item.handle}`,
                              postSchedule: item.postSchedule ?? [],
                            }))}
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setSettingsDraft(null);
                          }}
                        >
                          キャンセル
                        </Button>
                        <Button
                          loading={isSaving}
                          onClick={() => handleSaveSettings(account.id)}
                        >
                          保存する
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
