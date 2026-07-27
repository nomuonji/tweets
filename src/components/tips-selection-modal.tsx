"use client";

import { useState } from "react";
import type { AccountDoc, Tip } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export function TipsSelectionModal({
  account,
  allTips,
  onClose,
  onSave,
}: {
  account: AccountDoc;
  allTips: Tip[];
  onClose: () => void;
  onSave: (updatedTipIds: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    account.selectedTipIds ?? [],
  );
  const [isSaving, setIsSaving] = useState(false);

  const toggle = (tipId: string) => {
    setSelectedIds((prev) =>
      prev.includes(tipId)
        ? prev.filter((id) => id !== tipId)
        : [...prev, tipId],
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(selectedIds);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`@${account.handle} で使う Tips`}
      description="選択した Tips が、投稿生成時のプロンプトに含まれます。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            キャンセル
          </Button>
          <Button loading={isSaving} onClick={handleSave}>
            保存する（{selectedIds.length}件）
          </Button>
        </>
      }
    >
      {allTips.length === 0 ? (
        <EmptyState
          title="Tips がまだ登録されていません"
          description="Tips ページから追加すると、ここで選択できるようになります。"
        />
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {allTips.map((tip) => {
            const checked = selectedIds.includes(tip.id);
            return (
              <li key={tip.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    checked
                      ? "border-primary/40 bg-primary/5"
                      : "border-transparent hover:bg-surface-hover",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(tip.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-[rgb(var(--primary))]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {tip.title}
                    </span>
                    {tip.text ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {tip.text}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
