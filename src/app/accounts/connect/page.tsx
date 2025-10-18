import Link from "next/link";
import type { Metadata } from "next";
import { ManualAccountForm } from "@/components/accounts/manual-account-form";

export const metadata: Metadata = {
  title: "アカウント連携 | SNS分析・投稿支援",
};

export default function AccountsConnectPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">アカウント連携</h1>
        <p className="text-sm text-muted-foreground">
          下記の「認可フローを開始」は実際の OAuth 認証を起動します。まだコールバック実装や環境変数の準備ができていない場合は、先にガイドを確認してください。
        </p>
        <p className="text-sm text-muted-foreground">
          取得済みトークンを手動で保存したい場合は、右側の「トークン直接登録」を利用できます。
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-lg font-semibold">OAuth 認証</h2>
          <div className="space-y-3">
            <div className="space-y-2 rounded-md border border-muted p-4">
              <h3 className="text-base font-semibold">X (旧Twitter)</h3>
              <p className="text-sm text-muted-foreground">
                Twitter Developer Portal でアプリ登録と Callback URL の設定を済ませたうえで開始してください。
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/oauth/x/authorize"
                  className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  認可フローを開始
                </a>
                <Link
                  href="/accounts/x/oauth"
                  className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-primary"
                >
                  手順ガイドを見る
                </Link>
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-muted p-4">
              <h3 className="text-base font-semibold">Threads</h3>
              <p className="text-sm text-muted-foreground">
                Meta App Dashboard で Threads API の認証情報とリダイレクト URI を設定してから実行してください。
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/oauth/threads/authorize"
                  className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  認可フローを開始
                </a>
                <Link
                  href="/accounts/threads/oauth"
                  className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-primary"
                >
                  手順ガイドを見る
                </Link>
              </div>
            </div>
          </div>
        </article>

        <article className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-lg font-semibold">トークン直接登録</h2>
          <p className="text-sm text-muted-foreground">
            取得済みのアクセストークンやリフレッシュトークンをそのまま Firestore に保存できます。保存後はダッシュボードで同期ボタンを実行してください。
          </p>
          <ManualAccountForm />
        </article>
      </section>

      <section className="space-y-3 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">保存される主なフィールド</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>`connected: true` と入力した `scopes` が記録されます。</li>
          <li>`token_meta.access_token` / `refresh_token` / `expires_at` / `refreshed_at` を保存します。</li>
          <li>既存ドキュメントに保存すると上書きされ、`updated_at` が更新されます。</li>
          <li>初回同期後に `sync_cursor` が自動で設定されます。</li>
        </ul>
      </section>
    </div>
  );
}