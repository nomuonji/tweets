import {
  oauthScope,
  pkceChallenge,
  signOAuthToken,
  verifyOAuthToken,
} from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const body = await request.formData();
  const grantType = String(body.get("grant_type") ?? "");

  if (grantType === "refresh_token") {
    const refresh = verifyOAuthToken(String(body.get("refresh_token") ?? ""), "refresh");
    if (!refresh) return json({ error: "invalid_grant" }, 400);

    const clientId = String(refresh.clientId ?? "");
    const scope = String(refresh.scope ?? oauthScope());

    return json({
      access_token: signOAuthToken("access", { clientId, scope }),
      token_type: "Bearer",
      expires_in: 3600,
      scope,
    });
  }

  if (grantType !== "authorization_code") {
    return json({ error: "unsupported_grant_type" }, 400);
  }

  const code = verifyOAuthToken(String(body.get("code") ?? ""), "code");
  const verifier = String(body.get("code_verifier") ?? "");
  const redirectUri = String(body.get("redirect_uri") ?? "");
  const clientId = String(body.get("client_id") ?? "");

  if (
    !code ||
    !verifier ||
    code.redirectUri !== redirectUri ||
    code.clientId !== clientId ||
    code.challenge !== pkceChallenge(verifier)
  ) {
    return json({ error: "invalid_grant" }, 400);
  }

  const scope = String(code.scope ?? oauthScope());

  return json({
    access_token: signOAuthToken("access", { clientId, scope }),
    refresh_token: signOAuthToken("refresh", { clientId, scope }),
    token_type: "Bearer",
    expires_in: 3600,
    scope,
  });
}
