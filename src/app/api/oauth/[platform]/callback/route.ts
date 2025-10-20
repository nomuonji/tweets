import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { upsertAccount } from "@/lib/services/account-service";

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
  console.info("[OAuth:X] callback", { code, state });
  const stored = readCookie("oauth_x");
  console.info("[OAuth:X] stored", stored);
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
    },
    extra: {
      twitter_user_id: userData.data.id,
    },
  });

  return redirectWithMessage("x", requestUrl, "X アカウントを連携しました。", "success");
}

async function handleThreadsCallback(code: string, state: string, requestUrl: URL) {
  console.info("[OAuth:Threads] callback", { code, state });
  const stored = readCookie("oauth_threads");
  console.info("[OAuth:Threads] stored", stored);
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

  const tokenUrl = new URL("https://graph.facebook.com/v18.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const tokenResponse = await fetch(tokenUrl.toString(), { method: "GET" });
  if (!tokenResponse.ok) {
    const detail = await safeJson(tokenResponse);
    return redirectWithMessage(
      "threads",
      requestUrl,
      `トークンの取得に失敗しました: ${tokenResponse.status} ${JSON.stringify(detail)}`,
    );
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const profileResponse = await fetch(
    "https://graph.facebook.com/v18.0/me?fields=id,name,username",
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    },
  );

  if (!profileResponse.ok) {
    const detail = await safeJson(profileResponse);
    return redirectWithMessage(
      "threads",
      requestUrl,
      `ユーザー情報の取得に失敗しました: ${profileResponse.status} ${JSON.stringify(detail)}`,
    );
  }

  const profile = (await profileResponse.json()) as {
    id?: string;
    name?: string;
    username?: string;
  };

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
      refreshToken: undefined,
      expiresAt,
      userId: profile.id,
    },
    extra: {
      threads_user_id: profile.id,
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
