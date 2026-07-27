import Link from "next/link";
import type { Metadata } from "next";
import { ManualAccountForm } from "@/components/accounts/manual-account-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { linkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "アカウント連携 | SNS分析・投稿支援",
};

const OAUTH_PROVIDERS = [
  {
    id: "x",
    name: "X（旧 Twitter）",
    description:
      "Twitter Developer Portal でアプリ登録と Callback URL の設定を済ませてから開始してください。",
  },
  {
    id: "threads",
    name: "Threads",
    description:
      "Meta App Dashboard で Threads API の認証情報とリダイレクト URI を設定してから実行してください。",
  },
];

export default function AccountsConnectPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="アカウント連携"
        description="OAuth 認可フローで連携するか、取得済みのトークンを直接登録できます。"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>OAuth で連携</CardTitle>
            <CardDescription>
              ボタンを押すと実際の認可フローが始まります。事前に環境変数とコールバック URL の設定が必要です。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {OAUTH_PROVIDERS.map((provider) => (
              <div
                key={provider.id}
                className="space-y-2 rounded-md border border-border p-4"
              >
                <h3 className="text-sm font-semibold">{provider.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {provider.description}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={`/api/oauth/${provider.id}/authorize`}
                    className={linkButton("primary", "sm")}
                  >
                    認可フローを開始
                  </a>
                  <Link
                    href={`/accounts/${provider.id}/oauth`}
                    className={linkButton("outline", "sm")}
                  >
                    手順ガイド
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>トークンを直接登録</CardTitle>
            <CardDescription>
              取得済みのアクセストークンをそのまま保存します。保存後にダッシュボードで同期を実行してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ManualAccountForm />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>保存される主なフィールド</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                connected: true
              </code>{" "}
              と入力した <code className="rounded bg-muted px-1 py-0.5 text-xs">scopes</code>{" "}
              が記録されます。
            </li>
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                token_meta
              </code>{" "}
              に access_token / refresh_token / expires_at / refreshed_at を保存します。
            </li>
            <li>
              既存のアカウントに保存すると上書きされ、updated_at が更新されます。
            </li>
            <li>初回同期後に sync_cursor が自動で設定されます。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
