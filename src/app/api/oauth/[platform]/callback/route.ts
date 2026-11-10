import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { upsertAccount } from "@/lib/services/account-service";
import { getThreadsUserProfile } from "@/lib/platforms/threads";
import { resolveThreadsOAuthScopes } from "@/lib/oauth/threads-scopes";

type RouteContext = {
  params: {
    platform: string;
  };
};

type StoredState = {
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  createdAt: number;
};

export async function GET(request: Request, { params }: RouteContext) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");

  if (error) {
    return redirectWithMessage(params.platform, requestUrl, `認可エラー: ${error}`);
  }
  if (!code || !state) {
    return redirectWithMessage(params.platform, requestUrl, "認可コードまたはステートが見つかりません。");
  }

  if (params.platform === "x") {
    return handleXCallback(code, state, requestUrl);
  }
  if (params.platform === "threads") {
    return handleThreadsCallback(code, state, requestUrl);
  }

  return NextResponse.json({ ok: false, message: "Unsupported platform." }, { status: 404 });
}

async function handleXCallback(code: string, state: string, requestUrl: URL) {
  const stored = readCookie("oauth_x");
  clearCookie("oauth_x");

  if (!stored || stored.state !== state || !stored.codeVerifier) {
    return redirectWithMessage("x", requestUrl, "ステートが一致しません。再度お試しください。");
  }

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = stored.redirectUri;

  if (!clientId || !clientSecret || !redirectUri) {
    return redirectWithMessage("x", requestUrl, "X OAuth 環境変数が不足しています。");
  }

  const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: stored.codeVerifier,
      client_id: clientId,
    }),
  });

  if (!tokenResponse.ok) {
    const detail = await safeJson(tokenResponse);
    return redirectWithMessage(
      "x",
      requestUrl,
      `トークンの取得に失敗しました: ${tokenResponse.status} ${JSON.stringify(detail)}`,
    );
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  const userResponse = await fetch("https://api.twitter.com/2/users/me", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userResponse.ok) {
    const detail = await safeJson(userResponse);
    return redirectWithMessage(
      "x",
      requestUrl,
      `ユーザー情報の取得に失敗しました: ${userResponse.status} ${JSON.stringify(detail)}`,
    );
  }

  const userData = (await userResponse.json()) as {
    data?: { id: string; username: string; name: string };
  };

  if (!userData.data?.username) {
    return redirectWithMessage("x", requestUrl, "ユーザー情報が取得できませんでした。");
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : undefined;

  await upsertAccount({
    platform: "x",
    handle: userData.data.username,
    displayName: userData.data.name ?? userData.data.username,
    scopes: tokenData.scope ? tokenData.scope.split(" ") : [],
    token: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      userId: userData.data.id,
    },
    extra: {
      twitter_user_id: userData.data.id,
    },
  });

  return redirectWithMessage("x", requestUrl, "X アカウントを連携しました。", "success");
}

async function handleThreadsCallback(code: string, state: string, requestUrl: URL) {
  const stored = readCookie("oauth_threads");
  clearCookie("oauth_threads");

  if (!stored || stored.state !== state) {
    return redirectWithMessage("threads", requestUrl, "ステートが一致しません。再度お試しください。");
  }

  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  const redirectUri = stored.redirectUri;

  if (!appId || !appSecret || !redirectUri) {
    return redirectWithMessage("threads", requestUrl, "Threads OAuth 環境変数が不足しています。");
  }

  const shortLivedTokenUrl = new URL("https://graph.threads.net/oauth/access_token");
  shortLivedTokenUrl.searchParams.set("client_id", appId);
  shortLivedTokenUrl.searchParams.set("client_secret", appSecret);
  shortLivedTokenUrl.searchParams.set("grant_type", "authorization_code");
  shortLivedTokenUrl.searchParams.set("redirect_uri", redirectUri);
  shortLivedTokenUrl.searchParams.set("code", code);

  const shortLivedTokenResponse = await fetch(shortLivedTokenUrl.toString(), {
    method: "POST",
  });
  if (!shortLivedTokenResponse.ok) {
    const detail = await safeJson(shortLivedTokenResponse);
    return redirectWithMessage(
      "threads",
      requestUrl,
      `トークンの取得に失敗しました: ${shortLivedTokenResponse.status} ${JSON.stringify(detail)}`,
    );
  }

  const shortLivedTokenData = (await shortLivedTokenResponse.json()) as {
    access_token: string;
  };

  // Store only a long-lived token. The short-lived token is never persisted.
  const longLivedTokenUrl = new URL("https://graph.threads.net/access_token");
  longLivedTokenUrl.searchParams.set("grant_type", "th_exchange_token");
  longLivedTokenUrl.searchParams.set("client_secret", appSecret);
  longLivedTokenUrl.searchParams.set("access_token", shortLivedTokenData.access_token);

  const longLivedTokenResponse = await fetch(longLivedTokenUrl.toString(), {
    method: "GET",
  });
  if (!longLivedTokenResponse.ok) {
    const detail = await safeJson(longLivedTokenResponse);
    return redirectWithMessage(
      "threads",
      requestUrl,
      `長期トークンへの交換に失敗しました: ${longLivedTokenResponse.status} ${JSON.stringify(detail)}`,
    );
  }

  const tokenData = (await longLivedTokenResponse.json()) as {
    access_token: string;
    expires_in?: number;
    token_type?: string;
  };

  let profile: { id: string; name?: string; username?: string };
  try {
    profile = await getThreadsUserProfile(tokenData.access_token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return redirectWithMessage("threads", requestUrl, `ユーザー情報の取得に失敗しました: ${message}`);
  }

  if (!profile.id) {
    return redirectWithMessage("threads", requestUrl, "Threads のユーザー情報が取得できませんでした。");
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : undefined;

  const handle = profile.username ?? profile.id;

  await upsertAccount({
    platform: "threads",
    handle,
    displayName: profile.name ?? handle,
    scopes: [],
    token: {
      accessToken: tokenData.access_token,
      // Threads long-lived user tokens are refreshed using the current access token.
      refreshToken: tokenData.access_token,
      expiresAt,
      userId: profile.id,
    },
    extra: {
      threads_user_id: profile.id,
      threads_scopes_requested: resolveThreadsOAuthScopes(),
    },
  });

  return redirectWithMessage("threads", requestUrl, "Threads アカウントを連携しました。", "success");
}

function readCookie(name: string): StoredState | null {
  try {
    const value = cookies().get(name)?.value;
    if (!value) return null;
    return JSON.parse(value) as StoredState;
  } catch {
    return null;
  }
}

function clearCookie(name: string) {
  cookies().set({
    name,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: 0,
  });
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

function redirectWithMessage(
  platform: string,
  requestUrl: URL,
  message: string,
  status: "success" | "error" = "error",
) {
  const location = new URL(
    `/accounts/connect?platform=${platform}&status=${status}&message=${encodeURIComponent(message)}`,
    `${requestUrl.origin}/`,
  );
  return NextResponse.redirect(location);
}
