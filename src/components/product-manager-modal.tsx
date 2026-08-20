"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProductDoc } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

type ProductManagerModalProps = {
  account: { id: string; handle: string };
  onClose: () => void;
  onChanged?: () => void;
};

type FormState = {
  asin: string;
  title: string;
  url: string;
  price: string;
  category: string;
  description: string;
  promo_hook: string;
};

const EMPTY_FORM: FormState = {
  asin: "",
  title: "",
  url: "",
  price: "",
  category: "",
  description: "",
  promo_hook: "",
};

export function ProductManagerModal({
  account,
  onClose,
  onChanged,
}: ProductManagerModalProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [products, setProducts] = useState<ProductDoc[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/products`);
      const data = await res.json();
      if (data.ok) setProducts(data.products);
      else setError(data.message ?? "商品を読み込めませんでした。");
    } catch {
      setError("商品を読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  }, [account.id]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAdd = async () => {
    if (!form.asin.trim() || !form.title.trim()) return;
    setIsAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message ?? "登録に失敗しました。");
      setProducts((prev) => [data.product, ...prev]);
      setForm(EMPTY_FORM);
      toast.success("商品を登録しました。");
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggle = async (product: ProductDoc) => {
    setTogglingId(product.id);
    try {
      const res = await fetch(
        `/api/accounts/${account.id}/products?id=${product.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !product.enabled }),
        },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.message ?? "更新に失敗しました。");
      setProducts((prev) =>
        prev.map((item) =>
          item.id === product.id
            ? { ...item, enabled: !product.enabled }
            : item,
        ),
      );
      toast.success(
        product.enabled
          ? "商品をPR対象から外しました。"
          : "商品をPR対象に追加しました。",
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (product: ProductDoc) => {
    const ok = await confirm({
      title: "この商品を削除しますか？",
      description: `「${product.title}」を削除します。削除すると元に戻せません。`,
      confirmLabel: "削除する",
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(product.id);
    try {
      const res = await fetch(
        `/api/accounts/${account.id}/products?id=${product.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      setProducts((prev) => prev.filter((item) => item.id !== product.id));
      toast.success("商品を削除しました。");
      onChanged?.();
    } catch {
      toast.error("削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
  };

  const canSubmit = Boolean(form.asin.trim() && form.title.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={`@${account.handle} のPR商品`}
      description="登録した商品が、時々（確率ベース）生成される投稿内で紹介されます。"
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium">商品を追加</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ASIN" hint="Amazonの商品コード（B0から始まる英数字）">
              {(id) => (
                <Input
                  id={id}
                  value={form.asin}
                  onChange={(event) => setField("asin", event.target.value)}
                  placeholder="例: B0ABCDEFGH"
                />
              )}
            </Field>
            <Field label="商品名">
              {(id) => (
                <Input
                  id={id}
                  value={form.title}
                  onChange={(event) => setField("title", event.target.value)}
                  placeholder="例: 折りたたみ式ワイヤレスキーボード"
                />
              )}
            </Field>
            <Field label="URL" hint="アフィリエイトリンクを貼ると成果が発生します。">
              {(id) => (
                <Input
                  id={id}
                  value={form.url}
                  onChange={(event) => setField("url", event.target.value)}
                  placeholder="https://www.amazon.co.jp/dp/B0ABCDEFGH"
                />
              )}
            </Field>
            <Field label="価格">
              {(id) => (
                <Input
                  id={id}
                  value={form.price}
                  onChange={(event) => setField("price", event.target.value)}
                  placeholder="例: 3,980円"
                />
              )}
            </Field>
            <Field label="カテゴリ">
              {(id) => (
                <Input
                  id={id}
                  value={form.category}
                  onChange={(event) => setField("category", event.target.value)}
                  placeholder="例: 家電 / 文房具 / ガジェット"
                />
              )}
            </Field>
          </div>
          <Field label="ターゲット層に刺さる理由">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={form.description}
                onChange={(event) => setField("description", event.target.value)}
                placeholder="例: 在宅ワーカー向け。タイピング音が静かで集中しやすい。"
              />
            )}
          </Field>
          <Field label="おすすめの切り口（任意）">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={form.promo_hook}
                onChange={(event) => setField("promo_hook", event.target.value)}
                placeholder="例: 「机の上をスッキリさせたい人」への導入で紹介する"
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

        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            title="PR商品はまだありません"
            description="上のフォームから商品を登録すると、アカウントの投稿生成で紹介できるようになります。"
          />
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {products.map((product) => (
              <li
                key={product.id}
                className="rounded-lg border border-border bg-background p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{product.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{product.asin}</span>
                      {product.price ? <span>・{product.price}</span> : null}
                      {product.category ? (
                        <span>・{product.category}</span>
                      ) : null}
                      <span>・使用{product.times_used}回</span>
                    </div>
                    {product.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {product.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Checkbox
                      label={product.enabled ? "有効" : "停止中"}
                      checked={product.enabled}
                      disabled={togglingId === product.id}
                      onChange={() => handleToggle(product)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={deletingId === product.id}
                      onClick={() => handleDelete(product)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {deletingId === product.id ? null : (
                        <TrashIcon className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
                {product.url ? (
                  <a
                    href={product.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {product.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          PR対象の商品があると、アカウント設定の「PR率」に従って生成時に1つ選ばれ、投稿本文にリンクが含まれます。同じ商品が続かないよう、使用回数の少ない商品が優先されます。
        </p>
      </div>
    </Modal>
  );
}