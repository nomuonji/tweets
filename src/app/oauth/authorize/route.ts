import {
  oauthScope,
  safeRedirect,
  sameAccessKey,
  signOAuthToken,
} from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderAuthorize(request: Request, values: Record<string, string>) {
  const action = new URL("/oauth/authorize", request.url).toString();
  const hidden = Object.entries(values)
    .map(([key, value]) => `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`)
    .join("");

  return new Response(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Tweets Operator を接続</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:5rem auto;padding:1.5rem;color:#171717;background:#fafafa}
.card{background:white;border:1px solid #ddd;border-radius:14px;padding:24px}
h1{font-size:1.45rem;margin-top:0}
p,small{color:#555;line-height:1.6}
input,button{width:100%;box-sizing:border-box;padding:.8rem;margin:.45rem 0;font:inherit}
input{border:1px solid #bbb;border-radius:8px}
button{background:#111;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer}
code{font-size:.9em}
</style>
</head>
<body><div class="card">
<h1>Tweets Operator を接続</h1>
<p>この接続により、許可されたクライアントがTweets Operator MCPを利用できるようになります。</p>
<form method="post" action="${esc(action)}">
${hidden}
<label>アクセスキー
<input name="access_key" type="password" autocomplete="current-password" required autofocus>
</label>
<small>Vercel の <code>AGENT_MCP_TOKEN</code> と同じ値を入力してください。</small>
<button type="submit">許可して接続</button>
</form>
</div></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectUri = safeRedirect(url.searchParams.get("redirect_uri") ?? "");
  const clientId = url.searchParams.get("client_id") ?? "";
  const responseType = url.searchParams.get("response_type") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const challengeMethod = url.searchParams.get("code_challenge_method") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const scope = url.searchParams.get("scope") ?? oauthScope();

  if (
    responseType !== "code" ||
    !redirectUri ||
    !clientId ||
    !codeChallenge ||
    challengeMethod !== "S256"
  ) {
    return new Response("Invalid OAuth authorization request", { status: 400 });
  }

  return renderAuthorize(request, {
    redirect_uri: redirectUri.toString(),
    client_id: clientId,
    state,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
}

export async function POST(request: Request) {
  const body = await request.formData();
  const redirectUri = safeRedirect(String(body.get("redirect_uri") ?? ""));
  const clientId = String(body.get("client_id") ?? "");
  const state = String(body.get("state") ?? "");
  const scope = String(body.get("scope") ?? oauthScope());
  const challenge = String(body.get("code_challenge") ?? "");
  const challengeMethod = String(body.get("code_challenge_method") ?? "");
  const accessKey = String(body.get("access_key") ?? "");

  if (
    !redirectUri ||
    !clientId ||
    !challenge ||
    challengeMethod !== "S256" ||
    !sameAccessKey(accessKey)
  ) {
    return new Response("Authorization denied", { status: 401 });
  }

  const code = signOAuthToken("code", {
    redirectUri: redirectUri.toString(),
    clientId,
    challenge,
    scope,
  });

  redirectUri.searchParams.set("code", code);
  if (state) redirectUri.searchParams.set("state", state);

  return Response.redirect(redirectUri.toString(), 302);
}
