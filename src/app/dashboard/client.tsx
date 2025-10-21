'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { toTitleCase } from '@/lib/utils';
import type { AccountDoc, Tip, PostDoc, DraftDoc } from '@/lib/types';
import { AddAccountButton } from '@/components/add-account-button';
import { SyncControls } from '@/components/sync-controls';
import { SmartTweetGenerator } from '@/components/smart-tweet-generator';
import { ExemplaryPostManager } from '@/components/exemplary-post-manager';
import { AccountTipsControl } from '@/components/account-tips-control';
import { cn } from "@/lib/utils";

type DashboardClientProps = {
  initialAccounts: AccountDoc[];
  initialSelectedAccountId: string | null;
  initialApiUsage: { month: string; count: number };
  initialDrafts: DraftDoc[];
  initialAccountData: {
    stats: { postCount: number; bestPost: PostDoc | null };
    recentPosts: PostDoc[];
  } | null;
  allTips: Tip[];
  errors: {
    accountsError: boolean;
    draftsError: boolean;
    accountDataError: boolean;
    quotaExceeded: boolean;
  };
};

export function DashboardClient({
  initialAccounts,
  initialSelectedAccountId,
  initialApiUsage,
  initialDrafts,
  initialAccountData,
  allTips,
  errors,
}: DashboardClientProps) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const selectedAccount = accounts.find(acc => acc.id === initialSelectedAccountId) || accounts[0] || null;

  const handleTipsUpdate = (accountId: string, updatedTipIds: string[]) => {
    setAccounts(prev =>
      prev.map(acc =>
        acc.id === accountId ? { ...acc, selectedTipIds: updatedTipIds } : acc
      )
    );
  };

  const accountOptions = accounts.map(account => ({
    id: account.id,
    handle: account.handle,
    displayName: account.display_name,
    platform: account.platform,
  }));

  const accountLookup = new Map(accounts.map(account => [account.id, account]));
  const relevantDrafts = initialDrafts.slice(0, 20);
  const localZone = DateTime.local().zoneName;

  const formatDraftTimestamp = (draft: DraftDoc) => {
    const schedule = draft.schedule_time ? DateTime.fromISO(draft.schedule_time) : null;
    if (schedule?.isValid) {
      return `Scheduled: ${schedule.setZone(localZone).toFormat("yyyy-LL-dd HH:mm")}`;
    }
    const updated = DateTime.fromISO(draft.updated_at);
    if (updated.isValid) {
      const relative = updated.setZone(localZone).toRelative({ unit: "hours" });
      if (relative) return `Updated ${relative}`;
      return `Updated: ${updated.setZone(localZone).toFormat("yyyy-LL-dd HH:mm")}`;
    }
    return "Timing unknown";
  };

  const stats = initialAccountData?.stats;
  const bestPost = stats?.bestPost ?? null;
  const recentPosts = initialAccountData?.recentPosts ?? [];
  const lastSyncDate = selectedAccount?.sync_cursor ? DateTime.fromISO(selectedAccount.sync_cursor) : null;
  const lastSyncText = lastSyncDate?.isValid ? lastSyncDate.setZone(localZone).toFormat("yyyy-LL-dd HH:mm") : "-";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Monitor the selected account, usage, and top performing posts.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <AddAccountButton />
        </div>
      </div>

      {errors.accountsError && (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Failed to load account list. Ensure Firebase credentials are configured.
        </p>
      )}

      {accounts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No dashboard data available yet. Connect an account and run a sync.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">RapidAPI Twitter usage</p>
              <p className="mt-2 text-2xl font-semibold">{initialApiUsage.count}</p>
              <p className="text-xs text-muted-foreground">Month: {initialApiUsage.month || "N/A"}</p>
            </div>
            <div className="md:col-span-2">
              <SyncControls accounts={accountOptions} selectedAccountId={selectedAccount?.id ?? null} />
            </div>
          </div>

          {selectedAccount && <AccountTipsControl account={selectedAccount} allTips={allTips} onTipsUpdate={handleTipsUpdate} />}

          <SmartTweetGenerator accounts={accountOptions} />

          <ExemplaryPostManager selectedAccountId={selectedAccount?.id ?? null} />

          {errors.quotaExceeded && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              Firestore quota was exceeded while loading posts for this account.
            </p>
          )}

          {errors.accountDataError && !errors.quotaExceeded && (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Failed to load recent posts for the selected account. Check the Firebase console or server logs for details.
            </p>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Upcoming drafts</h2>
                  <p className="text-sm text-muted-foreground">Drafts and scheduled posts for the selected account.</p>
                </div>
                <span className="text-xs text-muted-foreground">Showing {relevantDrafts.length} item{relevantDrafts.length === 1 ? "" : "s"}</span>
              </div>

              {errors.draftsError ? (
                <p>Failed to load drafts.</p>
              ) : relevantDrafts.length === 0 ? (
                <p>No drafts yet.</p>
              ) : (
                <ul className="space-y-3">
                  {relevantDrafts.map((draft) => {
                    const account = draft.target_account_id ? accountLookup.get(draft.target_account_id) : selectedAccount;
                    const label = account ? `${toTitleCase(account.platform)} ・ @${account.handle}` : toTitleCase(draft.target_platform);
                    const statusTone = draft.status === "scheduled" ? "bg-emerald-100 text-emerald-700" : "bg-secondary/20 text-secondary-foreground";
                    return (
                      <li key={draft.id} className="rounded-lg border border-border bg-background p-4">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="flex flex-col">
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground">{formatDraftTimestamp(draft)}</span>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`}>{toTitleCase(draft.status)}</span>
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm text-foreground">{draft.text}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
              {selectedAccount ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{toTitleCase(selectedAccount.platform)}</p>
                      <h2 className="text-xl font-semibold">@{selectedAccount.handle}</h2>
                      <p className="text-sm text-muted-foreground">{selectedAccount.display_name}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedAccount.connected ? "bg-surface-active text-primary" : "bg-muted text-muted-foreground"}`}>
                      {selectedAccount.connected ? "Connected" : "Disconnected"}
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                     <div className="rounded-lg bg-muted p-3 text-center">
                       <p className="text-xs text-muted-foreground">Posts</p>
                       <p className="text-lg font-semibold">{stats?.postCount ?? "-"}</p>
                     </div>
                     <div className="rounded-lg bg-muted p-3 text-center">
                       <p className="text-xs text-muted-foreground">Last sync</p>
                       <p className="text-lg font-semibold">{lastSyncText}</p>
                     </div>
                     <div className="rounded-lg bg-muted p-3 text-center">
                       <p className="text-xs text-muted-foreground">Best Score</p>
                       <p className="text-lg font-semibold">{bestPost ? bestPost.score.toFixed(3) : "-"}</p>
                     </div>
                  </div>

                  {bestPost ? (
                    <Link href={bestPost.url ?? "#"} target="_blank" className="block rounded-lg border border-border bg-background p-4 text-sm transition hover:border-primary">
                      <p className="line-clamp-3 text-muted-foreground">{bestPost.text}</p>
                       <div className="mt-3 flex flex-wrap gap-2 text-xs">
                         {/* Metrics */}
                       </div>
                    </Link>
                  ) : <p>No posts yet.</p>}

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Recent posts</p>
                    {recentPosts.length > 0 ? (
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        {recentPosts.map((post) => (
                          <li key={post.id} className="rounded-md border border-border bg-background px-3 py-2">
                            <p className="line-clamp-2">{post.text}</p>
                            <div className="mt-1 flex items-center justify-between text-xs">
                              <span>{new Date(post.created_at).toLocaleString()}</span>
                              <span>Score: {post.score.toFixed(3)}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">Impr {post.metrics.impressions ?? "n/a"}</span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-700">Likes {post.metrics.likes}</span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-700">Reposts {post.metrics.reposts_or_rethreads}</span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700">Replies {post.metrics.replies}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : <p>No posts found.</p>}
                  </div>
                </>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Select an account to view detailed metrics.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}