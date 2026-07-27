"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountDoc, Tip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

type AccountTipsControlProps = {
  account: AccountDoc | null;
  onAccountUpdate: (accountId: string, updatedData: Partial<AccountDoc>) => void;
};

export function AccountTipsControl({
  account,
  onAccountUpdate,
}: AccountTipsControlProps) {
  const toast = useToast();
  const [tips, setTips] = useState<Tip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTipIds, setSelectedTipIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchTips = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/tips");
        const data = await res.json();
        if (!cancelled && data.ok) setTips(data.tips);
      } catch {
        if (!cancelled) toast.error("Tips を読み込めませんでした。");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchTips();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Reset the selection whenever the active account changes.
  useEffect(() => {
    setSelectedTipIds(new Set(account?.selectedTipIds ?? []));
  }, [account]);

  const savedIds = useMemo(
    () => new Set(account?.selectedTipIds ?? []),
    [account],
  );

  const isDirty =
    savedIds.size !== selectedTipIds.size ||
    Array.from(selectedTipIds).some((id) => !savedIds.has(id));

  const toggleTip = (tipId: string) => {
    setSelectedTipIds((prev) => {
      const next = new Set(prev);
      if (next.has(tipId)) next.delete(tipId);
      else next.add(tipId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!account) return;
    setIsSaving(true);
    const nextIds = Array.from(selectedTipIds);
    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedTipIds: nextIds }),
      });
      if (!response.ok) throw new Error();
      onAccountUpdate(account.id, { selectedTipIds: nextIds });
      toast.success("使用する Tips を更新しました。");
    } catch {
      toast.error("Tips の保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  if (!account) return null;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>使用する Tips</CardTitle>
        <CardDescription>
          選択した Tips が、投稿生成時のプロンプトに含まれます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : tips.length === 0 ? (
          <EmptyState
            title="Tips がまだありません"
            description="Tips ページから追加すると、ここで選択できます。"
          />
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {tips.map((tip) => {
              const checked = selectedTipIds.has(tip.id);
              return (
                <li key={tip.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-2.5 transition-colors",
                      checked
                        ? "border-primary/40 bg-primary/5"
                        : "border-transparent hover:bg-surface-hover",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTip(tip.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-[rgb(var(--primary))]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {tip.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {tip.text}
                        {tip.author_handle ? ` — @${tip.author_handle}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <span className="text-xs text-muted-foreground">
          {selectedTipIds.size} 件を選択中
        </span>
        <Button
          size="sm"
          loading={isSaving}
          disabled={!isDirty}
          onClick={handleSave}
        >
          {isDirty ? "変更を保存" : "保存済み"}
        </Button>
      </CardFooter>
    </Card>
  );
}
