import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { linkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ExternalLinkIcon } from "@/components/ui/icons";

const PROVIDER_GUIDE: Record<
  string,
  {
    name: string;
    docs: string;
    callbackNote: string;
    steps: string[];
  }
> = {
  x: {
    name: "X（旧 Twitter）",
    docs: "https://developer.twitter.com/en/docs/authentication/oauth-2-0/authorization-code",
    callbackNote:
      "使用するコールバック URL（例: /api/oauth/x/callback）を Twitter Developer Portal に登録し、redirect_uri として渡してください。",
    steps: [
      "Twitter Developer Portal でアプリを作成し、OAuth 2.0 の Client ID / Client Secret を取得します。",
      "PKCE つき Authorization Code Flow を使い、必要に応じて tweet.read / tweet.write / users.read / offline.access などのスコープを要求して認可 URL にリダイレクトします。",
      "返ってきた code と元の code_verifier を交換してアクセストークンとリフレッシュトークンを取得し、Firestore の /accounts に保存します。",
      "トークン保存後に npm run sync:posts を実行し、投稿を取り込んでスコアを計算します。",
    ],
  },
  threads: {
    name: "Threads",
    docs: "https://developers.facebook.com/docs/threads",
    callbackNote:
      "Threads Graph API を使う場合は、Meta（Facebook）App Dashboard でリダイレクト URI を設定してください。",
    steps: [
      "Meta for Developers で Threads 用のクライアント認証情報を発行します。",
      "投稿の読み取りと作成に必要な権限を申請します。必要に応じて審査を通してください。",
      "取得したアクセストークンとユーザー ID を Firestore の /accounts に保存します。",
      "トークンが失効する場合は npm run sync:refresh-tokens を定期実行するか、GitHub Actions の間隔を調整します。",
    ],
  },
};

type PageProps = {
  params: {
    platform: string;
  };
};

export default function ProviderOAuthGuide({ params }: PageProps) {
  const provider = PROVIDER_GUIDE[params.platform];

  if (!provider) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${provider.name} の OAuth 設定`}
        description="以下の手順で認可フローを完了させてください。実際のコールバック処理は API ルート側でトークンを保存します。"
      />

      <Card>
        <CardHeader>
          <CardTitle>設定手順</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {provider.steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="leading-relaxed text-muted-foreground">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>コールバックについて</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{provider.callbackNote}</p>
          <p>
            認可コードの交換後は、次のようなメタデータと合わせて Firestore に保存します。
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">
            {`{ connected: true, scopes: [...], token_meta: { expires_at, refresh_token } }`}
          </pre>
          <p>初回同期の成功後に sync_cursor が更新されます。</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <a
          href={provider.docs}
          target="_blank"
          rel="noopener noreferrer"
          className={linkButton("outline")}
        >
          <ExternalLinkIcon className="h-4 w-4" />
          公式ドキュメントを開く
        </a>
        <Link href="/accounts/connect" className={linkButton("ghost")}>
          アカウント連携に戻る
        </Link>
      </div>
    </div>
  );
}
