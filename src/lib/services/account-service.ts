import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { AccountDoc } from "@/lib/types";

type TokenParams = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  consumerKey?: string;
  consumerSecret?: string;
  accessTokenSecret?: string;
  oauthVersion?: "oauth2" | "oauth1";
  apiKey?: string;
  apiHost?: string;
  userId?: string;
};

type UpsertAccountParams = {
  platform: AccountDoc["platform"];
  handle: string;
  displayName: string;
  scopes: string[];
  token: TokenParams;
  extra?: Record<string, unknown>;
};

export async function upsertAccount(params: UpsertAccountParams) {
  const now = DateTime.utc().toISO();
  const docId = `${params.platform}_${params.handle}`;

  const tokenMeta: Record<string, unknown> = {
    access_token: params.token.accessToken,
    refreshed_at: now,
    oauth_version: params.token.oauthVersion ?? "oauth2",
  };

  if (params.token.refreshToken) {
    tokenMeta.refresh_token = params.token.refreshToken;
  }
  if (params.token.expiresAt) {
    tokenMeta.expires_at = params.token.expiresAt;
  }
  if (params.token.consumerKey) {
    tokenMeta.consumer_key = params.token.consumerKey;
  }
  if (params.token.consumerSecret) {
    tokenMeta.consumer_secret = params.token.consumerSecret;
  }
  if (params.token.accessTokenSecret) {
    tokenMeta.access_token_secret = params.token.accessTokenSecret;
  }
  if (params.token.apiKey) {
    tokenMeta.api_key = params.token.apiKey;
  }
  if (params.token.apiHost) {
    tokenMeta.api_host = params.token.apiHost;
  }
  if (params.token.userId) {
    tokenMeta.user_id = params.token.userId;
  }

  await adminDb.collection("accounts").doc(docId).set(
    {
      platform: params.platform,
      handle: params.handle,
      display_name: params.displayName,
      connected: true,
      scopes: params.scopes,
      token_meta: tokenMeta,
      updated_at: now,
      ...(params.extra ?? {}),
    },
    { merge: true },
  );
}
