import Link from "next/link";
import { notFound } from "next/navigation";

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
    name: "X (Twitter)",
    docs:
      "https://developer.twitter.com/en/docs/authentication/oauth-2-0/authorization-code",
    callbackNote:
      "Register the callback URL you plan to use (for example `/api/oauth/callback`) in the Twitter Developer Portal and pass it as `redirect_uri`.",
    steps: [
      "Create an application in the Twitter Developer Portal and obtain the OAuth 2.0 Client ID / Client Secret.",
      "Implement the Authorization Code Flow with PKCE. Request scopes such as `tweet.read tweet.write users.read offline.access` as needed and redirect the user to the authorization URL.",
      "Exchange the returned `code` together with the original `code_verifier` for an access token and refresh token, then store them in Firestore `/accounts`.",
      "After saving tokens, run `npm run sync:posts` to pull the latest posts for scoring.",
    ],
  },
  threads: {
    name: "Threads",
    docs: "https://developers.facebook.com/docs/threads",
    callbackNote:
      "Configure your Redirect URI in the Meta (Facebook) App dashboard when using the Threads Graph API or alternative integration.",
    steps: [
      "Issue client credentials for Threads via Meta for Developers (or prepare the alternative integration you rely on).",
      "Request the required permissions for reading and posting content. Submit for review if necessary.",
      "Save the resulting access token and user identifiers into Firestore `/accounts`.",
      "If tokens expire, schedule `npm run sync:refresh-tokens` or adjust the GitHub Actions cadence.",
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
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{provider.name} OAuth setup</h1>
        <p className="text-sm text-muted-foreground">
          Use the checklist below to complete the OAuth flow. Handle the actual callback in an API route such as
          `/api/oauth/callback` where you can persist tokens into Firestore.
        </p>
      </header>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Steps</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          {provider.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="space-y-3 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">Callback notes</h2>
        <p>{provider.callbackNote}</p>
        <p>
          After exchanging the authorization code, store tokens together with metadata such as
          <code className="mx-1 inline-block rounded bg-muted px-1 py-0.5 text-xs text-foreground">
            {`{ connected: true, scopes: [...], token_meta: { expires_at, refresh_token } }`}
          </code>
          in Firestore. Update `sync_cursor` after the first successful sync.
        </p>
      </section>

      <section className="flex flex-wrap gap-3 text-sm">
        <Link
          href={provider.docs}
          target="_blank"
          className="rounded-md border border-primary px-3 py-2 text-primary transition hover:bg-primary hover:text-primary-foreground"
        >
          Open official docs
        </Link>
        <Link
          href="/accounts/connect"
          className="rounded-md px-3 py-2 text-muted-foreground transition hover:text-primary"
        >
          Back to account list
        </Link>
      </section>
    </div>
  );
}
