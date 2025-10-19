import Link from "next/link";
import { DateTime } from "luxon";
import type { Metadata } from "next";
import {
  getAccounts,
  getDashboardSummary,
} from "@/lib/services/firestore.server";
import { toTitleCase } from "@/lib/utils";

export const metadata: Metadata = {
  title: "アカウント一覧 | SNS分析・投稿支援",
};

export default async function AccountsIndexPage() {
  const [accounts, overview] = await Promise.all([
    getAccounts(),
    getDashboardSummary().catch(() => []),
  ]);

  const statsByAccountId = new Map(
    overview.map(({ account, stats }) => [account.id, stats]),
  );

  const sortedAccounts = accounts
    .slice()
    .sort((a, b) => a.handle.localeCompare(b.handle));

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">アカウント一覧</h1>
          <p className="text-sm text-muted-foreground">
            接続済みアカウントの同期状況やメトリクスを確認し、必要に応じて連携を追加してください。
          </p>
        </div>
        <Link
          href="/accounts/connect"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          新しいアカウントを連携
        </Link>
      </header>

      {sortedAccounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted-foreground">
          接続済みのアカウントがまだありません。<Link href="/accounts/connect" className="text-primary underline">アカウント連携ページ</Link>から追加してください。
        </div>
      ) : (
        <div className="space-y-4">
          {sortedAccounts.map((account) => {
            const stats = statsByAccountId.get(account.id);
            const updatedAt = DateTime.fromISO(account.updated_at ?? "").toLocal();
            const syncCursor = account.sync_cursor
              ? DateTime.fromISO(account.sync_cursor).toLocal()
              : null;

            return (
              <div
                key={account.id}
                className="rounded-xl border border-border bg-surface p-6 shadow-sm"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {toTitleCase(account.platform)}
                    </p>
                    <h2 className="text-xl font-semibold">@{account.handle}</h2>
                    {account.display_name && (
                      <p className="text-sm text-muted-foreground">
                        {account.display_name}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold ${
                        account.connected
                          ? "bg-surface-active text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {account.connected ? "Connected" : "Disconnected"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 font-medium text-muted-foreground">
                      スコープ: {account.scopes?.length ?? 0}
                    </span>
                    {account.token_meta?.api_key && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">
                        RapidAPI連携
                      </span>
                    )}
                    <Link
                      href={`/accounts/connect?handle=${encodeURIComponent(account.handle)}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 font-medium text-muted-foreground hover:text-primary"
                    >
                      設定を更新
                    </Link>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <p className="text-xs text-muted-foreground">投稿数</p>
                    <p className="text-lg font-semibold">
                      {stats?.postCount ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <p className="text-xs text-muted-foreground">平均スコア</p>
                    <p className="text-lg font-semibold">
                      {stats ? `${(stats.averageEngagement * 100).toFixed(2)}%` : "-"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <p className="text-xs text-muted-foreground">最終更新</p>
                    <p className="text-lg font-semibold">
                      {updatedAt.isValid ? updatedAt.toFormat("yyyy/LL/dd HH:mm") : "-"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <p className="text-xs text-muted-foreground">同期カーソル</p>
                    <p className="text-lg font-semibold">
                      {syncCursor?.isValid
                        ? syncCursor.toFormat("yyyy/LL/dd HH:mm")
                        : "未設定"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>
                    OAuth:{" "}
                    {toTitleCase(String(account.token_meta?.oauth_version ?? "oauth2"))}
                  </span>
                  {account.token_meta?.refreshed_at && (
                    <span>
                      リフレッシュ:{" "}
                      {DateTime.fromISO(account.token_meta.refreshed_at)
                        .toLocal()
                        .toFormat("yyyy/LL/dd HH:mm")}
                    </span>
                  )}
                  {account.token_meta?.expires_at && (
                    <span>
                      期限:{" "}
                      {DateTime.fromISO(account.token_meta.expires_at)
                        .toLocal()
                        .toFormat("yyyy/LL/dd HH:mm")}
                    </span>
                  )}
                  {account.token_meta?.user_id && (
                    <span>ID: {account.token_meta.user_id}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
