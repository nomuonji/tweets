import Link from "next/link";
import { PageHeader, Stat } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { getAccounts } from "@/lib/services/firestore.server";
import { getProductPool } from "@/lib/services/product-pool-service";
import {
  listAffiliateOffers,
} from "@/lib/services/affiliate-offer-service";
import {
  listOwnedContentItems,
  listOwnedContentSources,
} from "@/lib/services/owned-content-service";
import {
  getAffiliateDistributionRuntimeState,
  getProjectContext,
} from "@/lib/services/project-context-service";
import type { AccountDoc, ProductCatalogDoc } from "@/lib/types";
import type {
  AffiliateOfferRecord,
  AffiliateOfferStatus,
} from "@/lib/affiliate-distribution-policy";
import type {
  OwnedContentItemRecord,
  OwnedContentSourceRecord,
} from "@/lib/services/owned-content-service";

export const dynamic = "force-dynamic";

const OFFER_STATUS_LABELS: Record<AffiliateOfferStatus, string> = {
  candidate: "候補",
  pending_approval: "提携待ち",
  approved: "承認済み",
  active: "配信可能",
  paused: "停止中",
  archived: "アーカイブ",
};

const OFFER_STATUS_VARIANTS: Record<AffiliateOfferStatus, BadgeVariant> = {
  candidate: "default",
  pending_approval: "warning",
  approved: "primary",
  active: "success",
  paused: "warning",
  archived: "outline",
};

const PRODUCT_LIFECYCLE_LABELS: Record<
  NonNullable<ProductCatalogDoc["lifecycle_state"]>,
  string
> = {
  discovered: "発見",
  amazon_verified: "Amazon確認済み",
  creative_ready: "クリエイティブ準備済み",
  drafted: "下書き化",
  posted: "投稿済み",
  evaluated: "評価済み",
};

const PRODUCT_STATUS_LABELS = {
  candidate: "候補",
  approved: "採用",
  archived: "アーカイブ",
} as const;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  website: "Webサイト",
  note: "note",
  newsletter: "ニュースレター",
  other: "その他",
};

const MODE_LABELS: Record<string, string> = {
  off: "配信なし",
  amazon: "Amazon",
  affiliate_offer: "ASP案件",
  mixed: "Amazon + ASP",
};

function countBy<T>(items: T[], read: (item: T) => string | undefined) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = read(item) || "未設定";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function statusSummary(counts: Record<string, number>, labels: Record<string, string>) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${labels[key] ?? key} ${count}`)
    .join(" · ");
}

function formatReward(offer: AffiliateOfferRecord) {
  const reward = offer.reward;
  if (!reward) return "成果報酬未設定";
  if (reward.description) return reward.description;
  if (typeof reward.amount !== "number") return reward.type ?? "成果報酬";
  if (reward.type === "percentage") return `${reward.amount}%`;
  return `${reward.amount.toLocaleString()}${reward.currency ? ` ${reward.currency}` : ""}`;
}

function formatRevenue(value: unknown) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount === 0) return "—";
  return amount.toLocaleString();
}

function accountLabel(account: AccountDoc) {
  return account.handle ? `@${account.handle}` : account.display_name || account.id;
}

function compactUrl(url?: string) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function productLifecycleVariant(
  state: ProductCatalogDoc["lifecycle_state"],
): BadgeVariant {
  if (state === "evaluated" || state === "posted") return "success";
  if (state === "creative_ready" || state === "drafted") return "primary";
  if (state === "amazon_verified") return "warning";
  return "default";
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function NavChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      {children}
    </a>
  );
}

export default async function MonetizationPage() {
  const [
    accounts,
    products,
    offers,
    sources,
    ownedItems,
    discoveryContext,
    performanceContext,
    distributionContext,
    distributionRuntime,
  ] = await Promise.all([
    getAccounts(),
    getProductPool(),
    listAffiliateOffers({ limit: 200 }),
    listOwnedContentSources({ limit: 200 }),
    listOwnedContentItems({ limit: 500 }),
    getProjectContext("affiliate_product_discovery_v1"),
    getProjectContext("affiliate_product_performance_v1"),
    getProjectContext("affiliate_distribution_v1"),
    getAffiliateDistributionRuntimeState(),
  ]);

  const productStatuses = countBy(products, (item) => item.status);
  const productLifecycle = countBy(products, (item) => item.lifecycle_state);
  const offerStatuses = countBy(offers, (item) => item.status);
  const sourceStatuses = countBy(sources, (item) => item.status);
  const itemStatuses = countBy(ownedItems, (item) => item.status);
  const activeOffers = offers.filter((offer) => offer.status === "active");
  const activeSources = sources.filter((source) => source.status === "active");
  const activeItems = ownedItems.filter((item) => item.status === "active");
  const linkedProductPosts = products.reduce(
    (sum, product) => sum + (product.post_refs?.length ?? 0),
    0,
  );
  const offerPublishedReplies = offers.reduce(
    (sum, offer) => sum + Number(offer.performance?.published_replies ?? 0),
    0,
  );
  const offerConversions = offers.reduce(
    (sum, offer) => sum + Number(offer.performance?.conversions ?? 0),
    0,
  );
  const itemsBySource = new Map<string, OwnedContentItemRecord[]>();
  for (const item of ownedItems) {
    const list = itemsBySource.get(item.source_id) ?? [];
    list.push(item);
    itemsBySource.set(item.source_id, list);
  }

  const contexts = [
    { label: "Amazon商品探索", result: discoveryContext },
    { label: "Amazon商品評価", result: performanceContext },
    { label: "ASP配信", result: distributionContext },
  ].filter((entry) => entry.result.context);

  return (
    <div className="space-y-10">
      <PageHeader
        title="収益化ハブ"
        description="最新のDB構造に合わせて、Amazon商品・ASP案件・自社コンテンツ・配信ルールを別ドメインとして整理して表示します。"
        actions={
          <Link
            href="/accounts"
            className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-hover"
          >
            アカウント設定を見る
          </Link>
        }
      />

      <Card className={distributionRuntime.offerRepliesEnabled ? "border-success/30" : "border-warning/40 bg-warning/[0.04]"}>
        <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={distributionRuntime.offerRepliesEnabled ? "success" : "warning"}>
                ASP返信 {distributionRuntime.offerRepliesEnabled ? "ON" : "全体OFF"}
              </Badge>
              <span className="text-sm font-semibold">現在の配信ランタイム</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {distributionRuntime.offerRepliesEnabled
                ? "active なASP案件は、各アカウントの条件を通過した投稿に配信できます。"
                : "案件DBは保持されていますが、グローバルスイッチによりASP案件の自動返信は止まっています。"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            context rev. {distributionRuntime.contextRevision ?? "—"} · {distributionRuntime.source}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Amazon商品"
          value={products.length}
          hint={statusSummary(productStatuses, PRODUCT_STATUS_LABELS)}
        />
        <Stat
          label="ASP案件"
          value={offers.length}
          hint={statusSummary(offerStatuses, OFFER_STATUS_LABELS)}
        />
        <Stat
          label="自社コンテンツ"
          value={ownedItems.length}
          hint={`${activeSources.length}ソース · active ${activeItems.length}`}
        />
        <Stat
          label="運用アカウント"
          value={accounts.length}
          hint={`返信ON ${accounts.filter((a) => a.promoReplyEnabled === true).length} · 外部ASP禁止 ${accounts.filter((a) => a.affiliateThirdPartyEnabled === false).length}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>DBの見取り図</CardTitle>
          <CardDescription>
            名前が似ていますが、収益化経路ごとに正本が違います。ここを混ぜないのが現在の設計です。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-4">
          {[
            {
              title: "Amazon商品",
              collection: "/products",
              flow: "商品発見 → Amazon確認 → クリエイティブ → 下書き → 投稿 → 24h/72h評価",
              note: "画像主導の物販フロー。既存の商品カタログはここ。",
            },
            {
              title: "ASP案件",
              collection: "/affiliate_offers → /affiliate_replies",
              flow: "案件保存 → バズ投稿検出 → 文脈マッチ → PR返信 → 成果記録",
              note: "サービス・リード・サブスク等。Amazon商品とは別管理。",
            },
            {
              title: "自社コンテンツ",
              collection: "/owned_content_sources → /owned_content_items",
              flow: "配信元 → 記事 → アカウント適合 → 通常投稿へ紐付け",
              note: "自サイト・note等。アフィリエイト案件ではありません。",
            },
            {
              title: "運用プロトコル",
              collection: "/operator_contexts",
              flow: "探索・配信・評価ルールを会話外で永続化",
              note: "エージェントが次回も同じルールを使うための正本。",
            },
          ].map((lane) => (
            <div key={lane.title} className="rounded-lg border border-border bg-background p-4">
              <p className="font-semibold">{lane.title}</p>
              <code className="mt-2 block break-all text-xs text-primary">{lane.collection}</code>
              <p className="mt-3 text-sm leading-6">{lane.flow}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{lane.note}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <NavChip href="#accounts">アカウント配信設定</NavChip>
        <NavChip href="#amazon">Amazon商品</NavChip>
        <NavChip href="#offers">ASP案件</NavChip>
        <NavChip href="#owned">自社コンテンツ</NavChip>
        <NavChip href="#protocols">運用プロトコル</NavChip>
      </div>

      <section className="space-y-4">
        <SectionHeading
          id="accounts"
          eyebrow="Routing"
          title="アカウントごとの配信経路"
          description="promoReplyMode が未設定の既存アカウントは後方互換で Amazon 扱いです。ASP案件は第三者案件許可・返信ON・テーマ一致などを別途通過する必要があります。"
          action={
            <Link href="/accounts" className="text-sm font-medium text-primary hover:underline">
              設定を編集 →
            </Link>
          }
        />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">アカウント</th>
                  <th className="px-4 py-3 font-medium">配信モード</th>
                  <th className="px-4 py-3 font-medium">PR返信</th>
                  <th className="px-4 py-3 font-medium">第三者ASP</th>
                  <th className="px-4 py-3 font-medium">テーマ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accounts.map((account) => {
                  const mode = account.promoReplyMode ?? "amazon";
                  return (
                    <tr key={account.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium">{accountLabel(account)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{account.platform} · {account.id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={mode === "off" ? "outline" : mode === "affiliate_offer" || mode === "mixed" ? "primary" : "default"}>
                          {MODE_LABELS[mode] ?? mode}
                          {!account.promoReplyMode ? "（既定）" : ""}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={account.promoReplyEnabled ? "success" : "outline"}>
                          {account.promoReplyEnabled ? "ON" : "OFF"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className={account.affiliateThirdPartyEnabled === false ? "text-muted-foreground" : "font-medium"}>
                          {account.affiliateThirdPartyEnabled === false ? "禁止" : "許可"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-xl flex-wrap gap-1">
                          {(account.monetizationThemes ?? []).length ? (
                            (account.monetizationThemes ?? []).map((theme) => (
                              <Badge key={theme} variant="outline">{theme}</Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">未設定</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="amazon"
          eyebrow="Amazon Products"
          title="Amazon商品のライフサイクル"
          description="従来の candidate / approved / archived は採否です。新しい lifecycle_state は、発見後に実際の投稿・評価フローのどこまで進んだかを表します。"
          action={
            <Link href="/products" className="text-sm font-medium text-primary hover:underline">
              Amazon商品を管理 →
            </Link>
          }
        />
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="Amazon確認済み" value={productLifecycle.amazon_verified ?? 0} hint="販売・ASIN確認済み" />
          <Stat label="投稿紐付け" value={linkedProductPosts} hint="Product → Post refs" />
          <Stat
            label="評価済み"
            value={productLifecycle.evaluated ?? 0}
            hint={`strong ${products.reduce((n, p) => n + Number(p.performance?.strong_count ?? 0), 0)}`}
          />
        </div>
        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {Object.entries(productLifecycle).map(([state, count]) => (
                <span key={state} className="rounded-full bg-muted px-2.5 py-1">
                  {PRODUCT_LIFECYCLE_LABELS[state as keyof typeof PRODUCT_LIFECYCLE_LABELS] ?? state}: {count}
                </span>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {products.slice(0, 9).map((product) => (
                <article key={product.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="line-clamp-2 font-medium">{product.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{product.asin}</p>
                    </div>
                    <Badge variant={productLifecycleVariant(product.lifecycle_state)}>
                      {product.lifecycle_state
                        ? PRODUCT_LIFECYCLE_LABELS[product.lifecycle_state]
                        : "進捗未設定"}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge variant={product.amazon_verified ? "success" : "outline"}>
                      Amazon {product.amazon_verified ? "確認済み" : "未確認"}
                    </Badge>
                    <Badge variant={product.creative_status === "ready" ? "primary" : "outline"}>
                      Creative {product.creative_status ?? "未設定"}
                    </Badge>
                    {typeof product.viral_score === "number" ? (
                      <Badge variant="outline">viral {product.viral_score}</Badge>
                    ) : null}
                  </div>
                  {product.promo_hook ? (
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {product.promo_hook}
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>投稿 {product.post_refs?.length ?? 0} · 試行 {product.performance?.attempts ?? 0}</span>
                    {product.url || product.amazon_url ? (
                      <a
                        href={product.url || product.amazon_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        Amazon
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="offers"
          eyebrow="Affiliate Offers"
          title="ASP案件"
          description="Amazon物販とは別の /affiliate_offers。active の案件だけが配信候補になります。現在のグローバルスイッチがOFFなら、activeでも自動返信は行いません。"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="配信可能" value={activeOffers.length} hint="status = active" />
          <Stat label="公開済みPR返信" value={offerPublishedReplies} hint="offer performance" />
          <Stat label="成果件数" value={offerConversions} hint="手動/ASP取込を含む" />
        </div>
        {offers.length === 0 ? (
          <Card><CardContent className="text-sm text-muted-foreground">ASP案件はまだありません。</CardContent></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {offers.map((offer) => (
              <Card key={offer.id}>
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={OFFER_STATUS_VARIANTS[offer.status]}>{OFFER_STATUS_LABELS[offer.status]}</Badge>
                        <Badge variant="outline">{offer.network}</Badge>
                        <Badge variant="outline">{offer.kind}</Badge>
                      </div>
                      <h3 className="mt-2 font-semibold">{offer.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {offer.advertiser || "広告主未設定"} · {offer.category || "カテゴリ未設定"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-primary">{formatReward(offer)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {(offer.themes ?? []).map((theme) => <Badge key={theme} variant="outline">{theme}</Badge>)}
                  </div>

                  <div className="grid grid-cols-4 gap-2 rounded-md bg-muted/30 p-3 text-center">
                    <div><p className="text-lg font-semibold tabular-nums">{offer.performance?.published_replies ?? 0}</p><p className="text-[11px] text-muted-foreground">PR返信</p></div>
                    <div><p className="text-lg font-semibold tabular-nums">{offer.performance?.clicks ?? 0}</p><p className="text-[11px] text-muted-foreground">クリック</p></div>
                    <div><p className="text-lg font-semibold tabular-nums">{offer.performance?.conversions ?? 0}</p><p className="text-[11px] text-muted-foreground">成果</p></div>
                    <div><p className="text-lg font-semibold tabular-nums">{formatRevenue(offer.performance?.revenue)}</p><p className="text-[11px] text-muted-foreground">売上</p></div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      対象: {offer.allowedAccountIds?.length ? `${offer.allowedAccountIds.length}アカウント` : "全アカウント"}
                      {offer.allowedPlatforms?.length ? ` · ${offer.allowedPlatforms.join("/")}` : ""}
                    </span>
                    {offer.affiliateUrl || offer.destinationUrl ? (
                      <a
                        href={offer.affiliateUrl || offer.destinationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        {compactUrl(offer.affiliateUrl || offer.destinationUrl)}
                      </a>
                    ) : (
                      <span className="text-warning">URL未設定</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="owned"
          eyebrow="Owned Content"
          title="自社コンテンツ配信"
          description="自サイト・note・ニュースレター等を source、その中の記事を item として分離しています。記事数が多いため、ここではソース単位でまとめて表示します。"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="配信元" value={sources.length} hint={statusSummary(sourceStatuses, { active: "稼働", paused: "停止", archived: "保管" })} />
          <Stat label="記事" value={ownedItems.length} hint={statusSummary(itemStatuses, { candidate: "候補", active: "配信可", paused: "停止", archived: "保管" })} />
          <Stat label="稼働記事" value={activeItems.length} hint="status = active" />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {sources.map((source: OwnedContentSourceRecord) => {
            const items = itemsBySource.get(source.id) ?? [];
            const activeCount = items.filter((item) => item.status === "active").length;
            const candidateCount = items.filter((item) => item.status === "candidate").length;
            return (
              <Card key={source.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={source.status === "active" ? "success" : source.status === "paused" ? "warning" : "outline"}>
                          {source.status}
                        </Badge>
                        <Badge variant="outline">{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</Badge>
                        <Badge variant="outline">{source.provider}</Badge>
                      </div>
                      <CardTitle className="mt-2">{source.name}</CardTitle>
                      <CardDescription>
                        {items.length}記事 · active {activeCount} · candidate {candidateCount}
                      </CardDescription>
                    </div>
                    {source.base_url ? (
                      <a href={source.base_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                        {compactUrl(source.base_url)}
                      </a>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {items.slice(0, 8).map((item) => (
                    <a
                      key={item.id}
                      href={item.canonical_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {(item.themes ?? []).slice(0, 4).join(" · ") || compactUrl(item.canonical_url)}
                        </p>
                      </div>
                      <Badge variant={item.status === "active" ? "success" : item.status === "candidate" ? "default" : "outline"}>
                        {item.status}
                      </Badge>
                    </a>
                  ))}
                  {items.length > 8 ? (
                    <p className="pt-1 text-center text-xs text-muted-foreground">ほか {items.length - 8} 件</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="protocols"
          eyebrow="Operator Context"
          title="運用プロトコル"
          description="エージェントが会話履歴に依存せず、同じ探索・配信・評価ルールを継続するための永続コンテキストです。"
        />
        <div className="grid gap-4 lg:grid-cols-3">
          {contexts.map(({ label, result }) => {
            const context = result.context!;
            return (
              <Card key={context.key}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={context.status === "active" ? "success" : "outline"}>{context.status}</Badge>
                    <Badge variant="outline">v{String(context.version)}</Badge>
                    <Badge variant="outline">rev {context.revision}</Badge>
                  </div>
                  <CardTitle className="mt-2">{label}</CardTitle>
                  <CardDescription className="break-all">{context.key}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-4 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                    {context.content}
                  </p>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-primary">全文とメタデータを見る</summary>
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-5">
                      {context.content}
                    </pre>
                    {context.metadata ? (
                      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-5">
                        {JSON.stringify(context.metadata, null, 2)}
                      </pre>
                    ) : null}
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="py-4 text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">読み方:</span>{" "}
          Amazon商品は「商品そのものの投稿」、ASP案件は「伸びた通常投稿へのPR返信」、自社コンテンツは「自分の記事への自然な導線」です。
          3つを同じ商品DBとして扱わないことで、投稿ロジック・権利・成果計測を混同しない設計になっています。
        </CardContent>
      </Card>
    </div>
  );
}
