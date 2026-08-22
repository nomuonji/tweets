"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import type { AccountDoc, CharacterSheetRevision } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

export function CharacterSheetHistoryModal({
  account,
  onClose,
  onRestored,
}: {
  account: AccountDoc;
  onClose: () => void;
  onRestored: (concept: string, characterVersion: number) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [revisions, setRevisions] = useState<CharacterSheetRevision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `/api/accounts/${account.id}/character-sheet-history`,
        );
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message ?? "シート履歴を取得できませんでした。");
        }
        setRevisions(data.revisions as CharacterSheetRevision[]);
      } catch (error) {
        toast.error((error as Error).message);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [account.id, toast]);

  const restore = async (revision: CharacterSheetRevision) => {
    const ok = await confirm({
      title: `v${revision.character_version} のシートへ戻しますか？`,
      description:
        "現在のシートも履歴に保存されます。復元後は新しいキャラクター世代として投稿・分析を始めます。",
      confirmLabel: "復元する",
    });
    if (!ok) return;

    setRestoringId(revision.id);
    try {
      const response = await fetch(
        `/api/accounts/${account.id}/character-sheet-history/${revision.id}/restore`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "シートを復元できませんでした。");
      }
      onRestored(data.restored.concept, data.restored.characterVersion);
      toast.success("キャラクターシートを復元しました。");
      onClose();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`@${account.handle} のシート履歴`}
      description="復元しても現在のシートは履歴として保存されます。"
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>閉じる</Button>}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : revisions.length === 0 ? (
        <EmptyState
          title="保存済みの履歴はありません"
          description="次回キャラクターシートを変更すると、現在の内容がここに保存されます。"
        />
      ) : (
        <div className="space-y-3">
          {revisions.map((revision) => (
            <section key={revision.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">キャラクター v{revision.character_version}</p>
                  <p className="text-xs text-muted-foreground">
                    保存: {DateTime.fromISO(revision.archived_at).toFormat("yyyy/MM/dd HH:mm")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  loading={restoringId === revision.id}
                  onClick={() => restore(revision)}
                >
                  この内容へ戻す
                </Button>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {revision.concept}
              </p>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
