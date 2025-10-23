'use client';

import { useState, useEffect } from 'react';
import { DateTime } from 'luxon';
import type { AccountDoc, DraftDoc, PostDoc, PostMetrics } from '@/lib/types';
import { toTitleCase } from '@/lib/utils';

interface ScheduleData {
  scheduledDrafts: DraftDoc[];
  recentPosts: PostDoc[];
  accounts: AccountDoc[];
}

const PlatformBadge = ({ platform }: { platform: 'x' | 'threads' }) => {
  const style = platform === 'x'
    ? 'bg-black text-white'
    : 'bg-slate-200 text-slate-800';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${style}`}>
      {toTitleCase(platform)}
    </span>
  );
};

const MetricsDisplay = ({ metrics }: { metrics: PostMetrics }) => (
  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs">
    <span className="font-semibold text-muted-foreground">Reactions:</span>
    <span className="font-medium">Likes: {metrics.likes}</span>
    <span className="font-medium">Replies: {metrics.replies}</span>
    <span className="font-medium">Reposts: {metrics.reposts_or_rethreads}</span>
    {metrics.impressions != null && <span className="font-medium">Impressions: {metrics.impressions}</span>}
  </div>
);

export default function SchedulePage() {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSchedule() {
      try {
        setIsLoading(true);
        const response = await fetch('/api/schedule');
        const result = await response.json();

        if (!result.ok) {
          throw new Error(result.message || 'Failed to fetch schedule data.');
        }
        setData(result);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSchedule();
  }, []); // Empty dependency array, runs only once

  const accountMap = new Map(data?.accounts.map(acc => [acc.id, acc]));
  const localZone = DateTime.local().zoneName;

  const colorPalette = [
    'border-blue-400',
    'border-green-400',
    'border-pink-400',
    'border-yellow-400',
    'border-purple-400',
    'border-indigo-400',
    'border-red-400',
    'border-gray-400',
  ];

  const accountColorMap = new Map<string, string>();
  data?.accounts.forEach((account, index) => {
    accountColorMap.set(account.id, colorPalette[index % colorPalette.length]);
  });

  const renderPostItem = (post: DraftDoc | PostDoc, isDraft: boolean) => {
    const accountId = isDraft ? (post as DraftDoc).target_account_id! : (post as PostDoc).account_id;
    const account = accountMap.get(accountId);
    const time = isDraft ? (post as DraftDoc).schedule_time : (post as PostDoc).created_at;
    const formattedTime = time ? DateTime.fromISO(time).setZone(localZone).toFormat("yyyy-LL-dd HH:mm") : 'N/A';
    const borderColor = accountColorMap.get(accountId) || 'border-border';

    return (
      <li key={post.id} className={`rounded-lg border bg-surface p-4 space-y-3 shadow-sm transition-all hover:shadow-md border-l-4 ${borderColor}`}>
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-foreground">
            {account ? `@${account.handle}` : 'Unknown Account'}
          </span>
          {account && <PlatformBadge platform={account.platform} />}
        </div>
        <p className="text-foreground/90 whitespace-pre-wrap">{post.text}</p>
        {!isDraft && <MetricsDisplay metrics={(post as PostDoc).metrics} />}
        <div className="text-right text-xs text-muted-foreground pt-1">
          <span>{formattedTime}</span>
        </div>
      </li>
    );
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading schedule...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Content Schedule (All Accounts)</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Upcoming Posts</h2>
          {data?.scheduledDrafts && data.scheduledDrafts.length > 0 ? (
            <ul className="space-y-4">
              {data.scheduledDrafts.map(draft => renderPostItem(draft, true))}
            </ul>
          ) : (
            <div className="text-muted-foreground border border-dashed rounded-lg p-6 text-center">
              <p>No posts scheduled.</p>
              <p className="text-xs mt-1">Drafts with status &apos;scheduled&apos; will appear here.</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Recently Published (Last 24h)</h2>
          {data?.recentPosts && data.recentPosts.length > 0 ? (
            <ul className="space-y-4">
              {data.recentPosts.map(post => renderPostItem(post, false))}
            </ul>
          ) : (
            <p className="text-muted-foreground border border-dashed rounded-lg p-6 text-center">
              No posts in the last 24 hours.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}