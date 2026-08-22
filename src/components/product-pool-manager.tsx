"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountDoc, ProductPoolDoc, ProductPoolStatus } from "@/lib/types";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { AlertIcon, ExternalLinkIcon, InboxIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

type AccountOption = Pick<AccountDoc, "id" | "handle" | "display_name">;
type Props = { accounts: AccountOption[] };
type StatusFilter = "all" | ProductPoolStatus;
type FormState = Omit<ProductPoolDoc, "id" | "created_at" | "updated_at">;

const EMPTY_FORM: FormState = {
  asin: "", title: "", url: "", price: "", image_url: "", category: "", theme: "",
  role: "", description: "", promo_hook: "", score: 0, status: "candidate",
  account_ids: [], source_url: "", notes: "",
};

const STATUS_LABELS: Record<ProductPoolStatus, string> = { candidate: "候補", approved: "採用", archived: "保留" };
const STATUS_VARIANTS: Record<ProductPoolStatus, "default" | "success" | "warning"> = { candidate: "default", approved: "success", archived: "warning" };

export function ProductPoolManager({ accounts }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState<ProductPoolDoc[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const response = await fetch("/api/products");
      const data = await response.json();
      if (!data.ok) throw new Error(data.message ?? "商品プールを読み込めませんでした。");
      setProducts(data.products);
    } catch (err) { setError((err as Error).message); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const visibleProducts = useMemo(() => products.filter((product) => {
    const matchesStatus = filter === "all" || product.status === filter;
    const haystack = [product.title, product.asin, product.theme, product.category, product.promo_hook].join(" ").toLowerCase();
    return matchesStatus && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [filter, products, query]);

  const counts = useMemo(() => ({
    all: products.length,
    candidate: products.filter((p) => p.status === "candidate").length,
    approved: products.filter((p) => p.status === "approved").length,
    archived: products.filter((p) => p.status === "archived").length,
  }), [products]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); };

  const handleSave = async () => {
    if (!form.asin.trim() || !form.title.trim()) return;
    setIsSaving(true); setError(null);
    try {
      const response = await fetch(editingId ? `/api/products?id=${editingId}` : "/api/products", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message ?? "保存に失敗しました。");
      setProducts((prev) => editingId ? prev.map((item) => item.id === editingId ? data.product : item) : [data.product, ...prev]);
      toast.success(editingId ? "商品プールを更新しました。" : "商品をプールに追加しました。");
      resetForm();
    } catch (err) { setError((err as Error).message); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async (product: ProductPoolDoc) => {
    if (!(await confirm({ title: "この商品を削除しますか？", description: `「${product.title}」をプールから削除します。`, confirmLabel: "削除する", destructive: true }))) return;
    const response = await fetch(`/api/products?id=${product.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!data.ok) { toast.error(data.message ?? "削除に失敗しました。"); return; }
    setProducts((prev) => prev.filter((item) => item.id !== product.id));
    if (editingId === product.id) resetForm();
    toast.success("商品を削除しました。");
  };

  const edit = (product: ProductPoolDoc) => {
    setEditingId(product.id);
    setForm({ ...EMPTY_FORM, ...product });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const accountName = (id: string) => accounts.find((account) => account.id === id)?.handle ?? id;

  return (
    <div className="space-y-6">
      <PageHeader title="商品カタログ" description="商品情報はここを正本にし、アカウント側には採用状態と運用設定だけを持たせます。" actions={<Button onClick={() => { resetForm(); window.scrollTo({ top: 0, behavior: "smooth" }); }}><PlusIcon className="h-4 w-4" />商品を追加</Button>} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="全商品" value={counts.all} hint="プール内" />
        <Stat label="候補" value={counts.candidate} hint="これから検討" />
        <Stat label="採用" value={counts.approved} hint="運用に進める" />
        <Stat label="保留" value={counts.archived} hint="いったん寝かせる" />
      </div>

      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3"><InboxIcon className="mt-0.5 h-5 w-5 text-primary" /><div><p className="font-medium">このページの役割</p><p className="mt-1 text-sm text-muted-foreground">いきなりアカウントへ登録せず、「小さな特集として成立するか」を見ながら候補を育てる場所です。</p></div></div>
          <div className="grid gap-3 md:grid-cols-3"><input className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" placeholder="商品名・ASIN・テーマで検索" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)}><option value="all">すべての状態</option><option value="candidate">候補</option><option value="approved">採用</option><option value="archived">保留</option></select>
            <div className="flex items-center text-sm text-muted-foreground">表示中 {visibleProducts.length}件</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">{editingId ? "商品を編集" : "商品をプールに追加"}</h2><p className="mt-1 text-xs text-muted-foreground">ASINと商品名に加えて、特集のテーマと一言フックを残します。</p></div>{editingId ? <Button variant="ghost" size="sm" onClick={resetForm}>編集をキャンセル</Button> : null}</div>
          <div className="grid gap-3 md:grid-cols-3"><label className="space-y-1 text-sm"><span className="font-medium">ASIN *</span><Input value={form.asin} onChange={(event) => setField("asin", event.target.value)} placeholder="B0XXXXXXXX" /></label><label className="space-y-1 text-sm md:col-span-2"><span className="font-medium">商品名 *</span><Input value={form.title} onChange={(event) => setField("title", event.target.value)} placeholder="例: 琥珀色の耐熱グラス" /></label><label className="space-y-1 text-sm"><span className="font-medium">価格</span><Input value={form.price ?? ""} onChange={(event) => setField("price", event.target.value)} placeholder="1,980円" /></label><label className="space-y-1 text-sm md:col-span-2"><span className="font-medium">Amazon URL</span><Input value={form.url ?? ""} onChange={(event) => setField("url", event.target.value)} placeholder="https://www.amazon.co.jp/dp/..." /></label><label className="space-y-1 text-sm"><span className="font-medium">テーマ</span><Input value={form.theme ?? ""} onChange={(event) => setField("theme", event.target.value)} placeholder="家で喫茶店ごっこ" /></label><label className="space-y-1 text-sm"><span className="font-medium">役割</span><select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={form.role ?? ""} onChange={(event) => setField("role", event.target.value)}><option value="">未設定</option><option value="主役">主役</option><option value="相棒">相棒</option><option value="入口">低価格入口</option><option value="変化球">変化球</option><option value="実用品">実用品</option></select></label><label className="space-y-1 text-sm"><span className="font-medium">採点（25点満点）</span><Input type="number" min={0} max={25} value={form.score ?? 0} onChange={(event) => setField("score", Number(event.target.value))} /></label><label className="space-y-1 text-sm"><span className="font-medium">状態</span><select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={form.status} onChange={(event) => setField("status", event.target.value as ProductPoolStatus)}><option value="candidate">候補</option><option value="approved">採用</option><option value="archived">保留</option></select></label></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">対象アカウント（未選択なら共通プール）</legend><div className="flex flex-wrap gap-2">{accounts.map((account) => <label key={account.id} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"><input type="checkbox" checked={form.account_ids?.includes(account.id) ?? false} onChange={(event) => setField("account_ids", event.target.checked ? [...(form.account_ids ?? []), account.id] : (form.account_ids ?? []).filter((id) => id !== account.id))} />@{account.handle}</label>)}</div></fieldset>
          <label className="block space-y-1 text-sm"><span className="font-medium">一言フック</span><Textarea rows={2} value={form.promo_hook ?? ""} onChange={(event) => setField("promo_hook", event.target.value)} placeholder="例: これを置くだけで家が喫茶店っぽくなる" /></label>
          <label className="block space-y-1 text-sm"><span className="font-medium">選定理由・メモ</span><Textarea rows={2} value={form.description ?? ""} onChange={(event) => setField("description", event.target.value)} placeholder="画像性、場面性、会話性など。" /></label>
          <div className="flex flex-wrap items-center gap-2"><Button loading={isSaving} disabled={!form.asin.trim() || !form.title.trim()} onClick={handleSave}>{editingId ? "更新する" : "プールに追加"}</Button>{error ? <span className="flex items-center gap-1 text-sm text-destructive"><AlertIcon className="h-4 w-4" />{error}</span> : null}</div>
        </CardContent>
      </Card>

      {isLoading ? <SkeletonList rows={4} /> : visibleProducts.length === 0 ? <EmptyState title="該当する商品がありません" description="候補商品を追加するか、検索条件を変えてください。" /> : <div className="overflow-hidden rounded-lg border border-border bg-surface"><div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(150px,1fr)_100px_120px_100px] gap-4 border-b border-border bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground lg:grid"><span>商品</span><span>特集・役割</span><span>採点</span><span>対象アカウント</span><span>操作</span></div><div className="divide-y divide-border">{visibleProducts.map((product) => <div key={product.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(150px,1fr)_100px_120px_100px] lg:items-center lg:gap-4"><div className="min-w-0"><div className="flex items-start gap-3">{product.image_url ? <img src={product.image_url} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-lg">🛒</div>}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{product.title}</p><Badge variant={STATUS_VARIANTS[product.status]}>{STATUS_LABELS[product.status]}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{product.asin}{product.price ? ` ・ ${product.price}` : ""}{product.category ? ` ・ ${product.category}` : ""}</p>{product.promo_hook ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{product.promo_hook}</p> : null}</div></div>{product.url ? <a href={product.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLinkIcon className="h-3 w-3" />Amazonを開く</a> : null}</div><div className="text-sm"><p>{product.theme || "テーマ未設定"}</p><p className="mt-1 text-xs text-muted-foreground">{product.role || "役割未設定"}</p></div><div><span className="text-lg font-semibold tabular-nums">{product.score ?? "—"}</span><span className="text-xs text-muted-foreground"> / 25</span></div><div className="text-sm text-muted-foreground">{product.account_ids?.length ? product.account_ids.map(accountName).join(", ") : "共通プール"}</div><div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="編集" onClick={() => edit(product)}><PencilIcon className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="削除" onClick={() => handleDelete(product)} className="text-destructive hover:text-destructive"><TrashIcon className="h-4 w-4" /></Button></div></div>)}</div></div>}
    </div>
  );
}
