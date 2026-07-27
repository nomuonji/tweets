"use client";

import { useEffect, useState } from "react";
import type { ExemplaryPost } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

type ExemplaryPostManagerProps = {
  selectedAccountId: string | null;
};

export function ExemplaryPostManager({
  selectedAccountId,
}: ExemplaryPostManagerProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [posts, setPosts] = useState<ExemplaryPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;

    const fetchPosts = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/accounts/${selectedAccountId}/exemplary-posts`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) setPosts(data.posts);
        else setError(data.message ?? "お手本投稿を読み込めませんでした。");
      } catch {
        if (!cancelled) setError("お手本投稿を読み込めませんでした。");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchPosts();
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  const handleAdd = async () => {
    if (!selectedAccountId || !text.trim() || !explanation.trim()) return;
    setIsAdding(true);
    try {
      const res = await fetch(
        `/api/accounts/${selectedAccountId}/exemplary-posts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, explanation, platform: "x" }),
        },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.message ?? "登録に失敗しました。");
      setPosts((prev) => [data.post, ...prev]);
      setText("");
      setExplanation("");
      toast.success("お手本投稿を追加しました。");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (post: ExemplaryPost) => {
    if (!selectedAccountId) return;
    const ok = await confirm({
      title: "このお手本投稿を削除しますか？",
      description: "削除すると元に戻せません。",
      confirmLabel: "削除する",
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(post.id);
    try {
      const res = await fetch(
        `/api/accounts/${selectedAccountId}/exemplary-posts?id=${post.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      setPosts((prev) => prev.filter((item) => item.id !== post.id));
      toast.success("お手本投稿を削除しました。");
    } catch {
      toast.error("削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
  };

  if (!selectedAccountId) return null;

  const canSubmit = Boolean(text.trim() && explanation.trim());

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>お手本投稿</CardTitle>
        <CardDescription>
          真似したい文体や構成の例を登録すると、生成される投稿に反映されます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <Field label="投稿本文">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="お手本にしたい投稿の本文を貼り付けます"
              />
            )}
          </Field>
          <Field
            label="良いと感じた理由"
            hint="なぜ良いのかを書くほど、生成の精度が上がります。"
          >
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
                placeholder="例: 冒頭の一文で結論を提示していて続きが読みたくなる"
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button
              size="sm"
              loading={isAdding}
              disabled={!canSubmit}
              onClick={handleAdd}
            >
              {isAdding ? null : <PlusIcon className="h-3.5 w-3.5" />}
              追加する
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            tone="error"
            icon={<AlertIcon className="h-5 w-5" />}
            title="読み込みに失敗しました"
            description={error}
          />
        ) : posts.length === 0 ? (
          <EmptyState
            title="お手本投稿はまだありません"
            description="上のフォームから、参考にしたい投稿を登録してください。"
          />
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {posts.map((post) => (
              <li
                key={post.id}
                className="rounded-lg border border-border bg-background p-3"
              >
                <p className="whitespace-pre-wrap text-sm">{post.text}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  理由: {post.explanation}
                </p>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={deletingId === post.id}
                    onClick={() => handleDelete(post)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {deletingId === post.id ? null : (
                      <TrashIcon className="h-3.5 w-3.5" />
                    )}
                    削除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
