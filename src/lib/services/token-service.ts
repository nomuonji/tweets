import axios from "axios";
import { DateTime } from "luxon";
import { AccountDoc } from "@/lib/types";
import { getAccounts } from "./firestore.server";
import { adminDb } from "@/lib/firebase/admin";

const X_TOKEN_ENDPOINT = "https://api.twitter.com/2/oauth2/token";

async function refreshXToken(account: AccountDoc) {
  if (!account.token_meta?.refresh_token) {
    throw new Error(`No refresh token for account ${account.id}`);
  }

  const basicAuth = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`,
    "utf-8",
  ).toString("base64");

  const response = await axios.post(
    X_TOKEN_ENDPOINT,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.token_meta.refresh_token,
      client_id: process.env.X_CLIENT_ID ?? "",
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );

  const data = response.data;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? account.token_meta.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
  };
}

async function refreshThreadsToken(account: AccountDoc) {
  if (!account.token_meta?.refresh_token) {
    throw new Error(`No refresh token for account ${account.id}`);
  }
  const response = await axios.post(
    "https://graph.facebook.com/v17.0/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: process.env.THREADS_APP_ID,
      client_secret: process.env.THREADS_APP_SECRET,
      fb_exchange_token: account.token_meta.refresh_token,
    },
  );

  const data = response.data;
  return {
    access_token: data.access_token,
    refresh_token: data.access_token,
    expires_in: data.expires_in,
    token_type: "Bearer",
  };
}

async function refreshAccount(account: AccountDoc) {
  if (account.platform === "x") {
    return refreshXToken(account);
  }
  return refreshThreadsToken(account);
}

export async function refreshExpiringTokens() {
  const accounts = await getAccounts();
  const now = DateTime.utc();

  for (const account of accounts) {
    try {
      const expiresAt = account.token_meta?.expires_at
        ? DateTime.fromISO(account.token_meta.expires_at)
        : null;

      if (expiresAt && expiresAt.diff(now, "hours").hours > 48) {
        continue;
      }

      const token = await refreshAccount(account);
      const updatedAt = DateTime.utc().toISO();
      const expiresAtIso = DateTime.utc()
        .plus({ seconds: token.expires_in ?? 0 })
        .toISO();

      await adminDb.collection("accounts").doc(account.id).set(
        {
          token_meta: {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            refreshed_at: updatedAt,
            expires_at: expiresAtIso,
            token_type: token.token_type,
          },
          updated_at: updatedAt,
        },
        { merge: true },
      );

    } catch (error) {
      console.error("[Tokens] Failed to refresh account token", account.id, error);
    }
  }
}
