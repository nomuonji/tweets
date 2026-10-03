import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { AccountDoc } from "@/lib/types";
import { getThreadsUserProfile } from "@/lib/platforms/threads";
import { getXUserProfile } from "@/lib/platforms/x";
import { getAccounts } from "./firestore.server";

type AccountWithLegacyPlatformIds = AccountDoc & {
  twitter_user_id?: string;
  threads_user_id?: string;
};

type ProfileIdentity = {
  id: string;
  username: string;
  name: string;
};

export type AccountProfileSyncResult = {
  accountId: string;
  platform: AccountDoc["platform"];
  status: "updated" | "unchanged" | "dry_run" | "error";
  platformUserId?: string;
  storedPlatformUserId?: string;
  previous: {
    handle: string;
    displayName: string;
  };
  current?: {
    handle: string;
    displayName: string;
  };
  changedFields?: string[];
  error?: string;
};

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "");
}

function getStoredPlatformUserId(
  account: AccountWithLegacyPlatformIds,
): string | undefined {
  const tokenId = account.token_meta?.user_id?.trim();
  if (tokenId) return tokenId;

  const legacyId =
    account.platform === "x"
      ? account.twitter_user_id?.trim()
      : account.threads_user_id?.trim();
  return legacyId || undefined;
}

async function fetchProfileIdentity(
  account: AccountWithLegacyPlatformIds,
): Promise<ProfileIdentity> {
  if (account.platform === "x") {
    return getXUserProfile(account);
  }

  const accessToken = account.token_meta?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "Threads account has no saved access token; profile identity cannot be refreshed safely.",
    );
  }

  const profile = await getThreadsUserProfile(accessToken);
  const username = profile.username?.trim();
  if (!username) {
    throw new Error("Threads profile response did not include username.");
  }

  return {
    id: profile.id,
    username,
    name: profile.name?.trim() || username,
  };
}

export async function syncAccountProfiles(
  options: { accountIds?: string[]; dryRun?: boolean } = {},
): Promise<AccountProfileSyncResult[]> {
  const accounts = (await getAccounts()) as AccountWithLegacyPlatformIds[];
  const filter =
    options.accountIds && options.accountIds.length > 0
      ? new Set(options.accountIds)
      : null;
  const targets = filter
    ? accounts.filter((account) => filter.has(account.id))
    : accounts;

  const results: AccountProfileSyncResult[] = [];

  for (const account of targets) {
    const previous = {
      handle: account.handle,
      displayName: account.display_name,
    };

    try {
      const profile = await fetchProfileIdentity(account);
      const storedPlatformUserId = getStoredPlatformUserId(account);

      if (storedPlatformUserId && storedPlatformUserId !== profile.id) {
        results.push({
          accountId: account.id,
          platform: account.platform,
          status: "error",
          platformUserId: profile.id,
          ...(storedPlatformUserId ? { storedPlatformUserId } : {}),
          previous,
          error:
            "Platform user ID mismatch. Refusing to update handle/display_name because the token resolved to a different account.",
        });
        continue;
      }

      const nextHandle = normalizeHandle(profile.username);
      const nextDisplayName = profile.name.trim() || nextHandle;
      const changedFields: string[] = [];
      const updates: Record<string, unknown> = {};

      if (normalizeHandle(account.handle) !== nextHandle) {
        updates.handle = nextHandle;
        changedFields.push("handle");
      }
      if ((account.display_name ?? "").trim() !== nextDisplayName) {
        updates.display_name = nextDisplayName;
        changedFields.push("display_name");
      }

      if (account.token_meta?.user_id !== profile.id) {
        updates["token_meta.user_id"] = profile.id;
        changedFields.push("token_meta.user_id");
      }

      const legacyIdField =
        account.platform === "x" ? "twitter_user_id" : "threads_user_id";
      const legacyId =
        account.platform === "x"
          ? account.twitter_user_id
          : account.threads_user_id;
      if (legacyId !== profile.id) {
        updates[legacyIdField] = profile.id;
        changedFields.push(legacyIdField);
      }

      if (changedFields.length === 0) {
        results.push({
          accountId: account.id,
          platform: account.platform,
          status: "unchanged",
          platformUserId: profile.id,
          ...(storedPlatformUserId ? { storedPlatformUserId } : {}),
          previous,
          current: {
            handle: nextHandle,
            displayName: nextDisplayName,
          },
          changedFields: [],
        });
        continue;
      }

      if (!options.dryRun) {
        const now = DateTime.utc().toISO()!;
        updates.profile_identity_synced_at = now;
        updates.updated_at = now;
        await adminDb.collection("accounts").doc(account.id).update(updates);
      }

      results.push({
        accountId: account.id,
        platform: account.platform,
        status: options.dryRun ? "dry_run" : "updated",
        platformUserId: profile.id,
        ...(storedPlatformUserId ? { storedPlatformUserId } : {}),
        previous,
        current: {
          handle: nextHandle,
          displayName: nextDisplayName,
        },
        changedFields,
      });
    } catch (error) {
      results.push({
        accountId: account.id,
        platform: account.platform,
        status: "error",
        ...(getStoredPlatformUserId(account)
          ? { storedPlatformUserId: getStoredPlatformUserId(account)! }
          : {}),
        previous,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
