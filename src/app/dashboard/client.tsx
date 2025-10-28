'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { toTitleCase } from '@/lib/utils';
import type { AccountDoc, PostDoc, DraftDoc } from '@/lib/types';
import { AddAccountButton } from '@/components/add-account-button';
import { SyncControls } from '@/components/sync-controls';
import { SmartTweetGenerator } from '@/components/smart-tweet-generator';
import { ExemplaryPostManager } from '@/components/exemplary-post-manager';
import { AccountTipsControl } from '@/components/account-tips-control';
import { AccountSettingsControl } from '@/components/account-settings-control';
import { useAccountContext } from '@/components/account/account-provider';

type DashboardClientProps = {
  initialAccounts: AccountDoc[];
  initialApiUsage: { month: string; count: number };
  initialDrafts: DraftDoc[];
  initialAccountData: {
    stats: { postCount: number; bestPost: PostDoc | null };
    recentPosts: PostDoc[];
  } | null;
  errors: {
    accountsError: boolean;
    draftsError: boolean;
    accountDataError: boolean;
    quotaExceeded: boolean;
  };
};

export function DashboardClient({
  initialAccounts,
  initialApiUsage,
  initialDrafts,
  initialAccountData,
  errors,
}: DashboardClientProps) {
  const { selectedAccount } = useAccountContext();

  const [accounts, setAccounts] = useState(initialAccounts);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [accountData, setAccountData] = useState(initialAccountData);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [editingDraft, setEditingDraft] = useState<DraftDoc | null>(null);
  const [editedText, setEditedText] = useState('');

  useEffect(() => {
    if (!selectedAccount) return;

    const fetchAccountData = async () => {
      setIsLoadingData(true);
      try {
        const response = await fetch(`/api/dashboard-data?accountId=${selectedAccount.id}`);
        const data = await response.json();
        if (data.ok) {
          setAccountData(data.accountData);
          setDrafts(data.drafts);
        }
      } catch (error) {
        console.error("Failed to fetch dashboard data", error);
      }
      setIsLoadingData(false);
    };

    fetchAccountData();

    const handleFocus = () => fetchAccountData();
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [selectedAccount]);

  const handleAccountUpdate = (accountId: string, updatedData: Partial<AccountDoc>) => {
    setAccounts(prev =>
      prev.map(acc =>
        acc.id === accountId ? { ...acc, ...updatedData } : acc
      )
    );
  };

  const handleDeleteDraft = async (draftId: string) => {
    if (!confirm('Are you sure you want to delete this draft?')) {
      return;
    }
    try {
      const response = await fetch(`/api/drafts/${draftId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete draft');
      }
      setDrafts(prev => prev.filter(d => d.id !== draftId));
    } catch (error) {
      console.error(error);
      alert('Error deleting draft.');
    }
  };

  const handleStatusChange = async (draftId: string, newStatus: 'draft' | 'scheduled' | 'published') => {
    try {
      const response = await fetch(`/api/drafts/${draftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        throw new Error('Failed to update status');
      }
      setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: newStatus, updated_at: new Date().toISOString() } : d));
    } catch (error) {
      console.error(error);
      alert('Error updating status.');
    }
  }; 
  
  const handleUpdateDraftText = async () => {
    if (!editingDraft) return;
    try {
      const response = await fetch(`/api/drafts/${editingDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editedText }),
      });
      if (!response.ok) {
        throw new Error('Failed to update draft text');
      }
      setDrafts(prev => prev.map(d => d.id === editingDraft.id ? { ...d, text: editedText, updated_at: new Date().toISOString() } : d));
      setEditingDraft(null);
    } catch (error) {
      console.error(error);
      alert('Error updating draft.');
    }
  };

    const handlePublishNow = async (draftId: string) => {
      if (!confirm('Are you sure you want to publish this draft immediately?')) {
        return;
      }
      try {
        const response = await fetch(`/api/drafts/${draftId}/publish`, {
          method: 'POST',
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to publish draft');
        }
        setDrafts(prev => prev.filter(d => d.id !== draftId));
        alert('Draft published successfully!');
      } catch (error) {
        console.error(error);
        alert(`Error publishing draft: ${(error as Error).message}`);
      }
    };
  
    const openEditModal = (draft: DraftDoc) => {
      setEditingDraft(draft);
      setEditedText(draft.text);
    };
  
    const accountOptions = accounts.map(account => ({
      id: account.id,
      handle: account.handle,
      displayName: account.display_name,
      platform: account.platform,
    }));
  
    const accountLookup = new Map(accounts.map(account => [account.id, account]));
    const relevantDrafts = drafts.slice(0, 20);
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
  
    const stats = accountData?.stats;
    const bestPost = stats?.bestPost ?? null;
    const recentPosts = accountData?.recentPosts ?? [];
    const lastSyncDate = selectedAccount?.sync_cursor ? DateTime.fromISO(selectedAccount.sync_cursor) : null;
    const lastSyncText = lastSyncDate?.isValid ? lastSyncDate.setZone(localZone).toFormat("yyyy-LL-dd HH:mm") : "-";
  
    return (
      <Fragment>
        {editingDraft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg rounded-lg bg-surface p-6 shadow-xl">
              <h3 className="text-lg font-semibold">Edit Draft</h3>
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                className="mt-4 h-40 w-full rounded-md border border-border bg-background p-2"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setEditingDraft(null)} className="rounded-md px-4 py-2 text-sm font-medium">Cancel</button>
                <button onClick={handleUpdateDraftText} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save</button>
              </div>
            </div>
          </div>
        )}
        <div className={`space-y-8 transition-opacity ${isLoadingData ? 'opacity-50' : 'opacity-100'}`}>
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
              {selectedAccount && <AccountSettingsControl account={selectedAccount} onAccountUpdate={handleAccountUpdate} />}
  
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
  
              <SmartTweetGenerator accounts={accountOptions} />
  
              <div className="grid gap-6 md:grid-cols-2">
                <ExemplaryPostManager selectedAccountId={selectedAccount?.id ?? null} />
                <AccountTipsControl account={selectedAccount} onAccountUpdate={handleAccountUpdate} />
              </div>
  
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
                        return (
                          <li key={draft.id} className="rounded-lg border border-border bg-background p-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div className="flex flex-col">
                                <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
                                <span className="text-xs text-muted-foreground">{formatDraftTimestamp(draft)}</span>
                              </div>
                              <select
                                value={draft.status}
                                onChange={(e) => handleStatusChange(draft.id, e.target.value as DraftDoc["status"])}
                                className="rounded-md border-border bg-background text-xs"
                              >
                                <option value="draft">Draft</option>
                                <option value="scheduled">Scheduled</option>
                                <option value="published">Published</option>
                              </select>
                            </div>
                            <p className="mt-2 line-clamp-3 text-sm text-foreground">{draft.text}</p>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button onClick={() => handlePublishNow(draft.id)} className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90">Post Now</button>
                              <button onClick={() => openEditModal(draft)} className="rounded-md px-3 py-1 text-xs hover:bg-muted">Edit</button>
                              <button onClick={() => handleDeleteDraft(draft.id)} className="rounded-md px-3 py-1 text-xs text-red-500 hover:bg-red-500/10">Delete</button>
                            </div>
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
      </Fragment>
    );
  }