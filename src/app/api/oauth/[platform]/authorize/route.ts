import { NextResponse } from "next/server";
import { createCodeChallenge, createCodeVerifier, createState } from "@/lib/oauth/pkce";

type RouteContext = {
  params: {
    platform: string;
  };
};

export async function GET(request: Request, { params }: RouteContext) {
  if (params.platform === "x") {
    return authorizeX();
  }
  if (params.platform === "threads") {
    return authorizeThreads();
  }
  return NextResponse.json({ ok: false, message: "Unsupported platform." }, { status: 404 });
}

function authorizeX() {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  const scope = process.env.X_SCOPES ?? "tweet.read tweet.write users.read offline.access";

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        ok: false,
        message: "X OAuth 環境変数 (X_CLIENT_ID, X_REDIRECT_URI) が設定されていません。",
      },
      { status: 500 },
    );
  }

  const state = createState();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "s256");

  const response = NextResponse.redirect(url.toString());
  response.cookies.set({
    name: "oauth_x",
    value: JSON.stringify({
      state,
      codeVerifier,
      createdAt: Date.now(),
      redirectUri,
    }),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: 600,
  });

  return response;
}

function authorizeThreads() {
  const appId = process.env.THREADS_APP_ID;
  const redirectUri = process.env.THREADS_REDIRECT_URI;
  const scope = process.env.THREADS_SCOPES ?? "threads_basic";

  if (!appId || !redirectUri) {
    return NextResponse.json(
      {
        ok: false,
        message: "Threads OAuth 環境変数 (THREADS_APP_ID, THREADS_REDIRECT_URI) が設定されていません。",
      },
      { status: 500 },
    );
  }

  const state = createState();

  const url = new URL("https://www.facebook.com/v18.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scope);

  const response = NextResponse.redirect(url.toString());
  response.cookies.set({
    name: "oauth_threads",
    value: JSON.stringify({
      state,
      createdAt: Date.now(),
      redirectUri,
    }),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: 600,
  });

  return response;
}