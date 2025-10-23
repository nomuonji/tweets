'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { PostDoc, RankingFilter } from '@/lib/types';
import { toTitleCase } from '@/lib/utils';
import { useAccountContext } from '@/components/account/account-provider';

interface RankingClientProps {
  initialPosts: PostDoc[];
  filters: Omit<RankingFilter, 'accountId'> & { sort: 'top' | 'latest' };
}

export function RankingClient({ initialPosts, filters }: RankingClientProps) {
  const { selectedAccount } = useAccountContext();
  const [posts, setPosts] = useState(initialPosts);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!selectedAccount) return;

    const fetchRankingData = async () => {
      setIsLoading(true);
      const params = new URLSearchParams({
        platform: filters.platform,
        media: filters.media_type,
        period: String(filters.period_days),
        sort: filters.sort,
        accountId: selectedAccount.id,
      });

      try {
        const response = await fetch(`/api/ranking-data?${params.toString()}`);
        const data = await response.json();
        if (data.ok) {
          setPosts(data.posts);
        }
      } catch (error) {
        console.error('Failed to fetch ranking data', error);
      }
      setIsLoading(false);
    };

    fetchRankingData();
  }, [selectedAccount, filters]);

  const handleDelete = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post from the database?')) {
      return;
    }
    try {
      const response = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete post');
      }
      setPosts(prevPosts => prevPosts.filter(p => p.id !== postId));
    } catch (error) {
      console.error('Error deleting post:', error);
      alert((error as Error).message);
    }
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-surface transition-opacity ${isLoading ? 'opacity-50' : 'opacity-100'}`}>
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Post</th>
            <th className="px-4 py-3">Platform</th>
            <th className="px-4 py-3">Media</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3 text-right">Score</th>
            <th className="px-4 py-3 text-right">Impressions</th>
            <th className="px-4 py-3 text-right">Likes</th>
            <th className="px-4 py-3 text-right">Reposts</th>
            <th className="px-4 py-3 text-right">Replies</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-sm">
          {posts.map((post) => (
            <tr key={post.id} className="hover:bg-surface-hover">
              <td className="px-4 py-4">
                <div className="space-y-2">
                  <p className="line-clamp-3 text-muted-foreground">{post.text}</p>
                  <Link
                    href={post.url ?? '#'}
                    target="_blank"
                    className="inline-flex items-center text-xs text-primary hover:underline"
                  >
                    Open post
                  </Link>
                </div>
              </td>
              <td className="px-4 py-4">
                <span className="rounded-full bg-surface-active px-3 py-1 text-xs font-semibold text-primary">
                  {toTitleCase(post.platform)}
                </span>
              </td>
              <td className="px-4 py-4 capitalize">{post.media_type}</td>
              <td className="px-4 py-4 text-sm text-muted-foreground">
                {new Date(post.created_at).toLocaleString()}
              </td>
              <td className="px-4 py-4 text-right">
                {post.score.toFixed(3)}
              </td>
              <td className="px-4 py-4 text-right">
                {post.metrics.impressions ?? 'n/a'}
              </td>
              <td className="px-4 py-4 text-right">{post.metrics.likes}</td>
              <td className="px-4 py-4 text-right">
                {post.metrics.reposts_or_rethreads}
              </td>
              <td className="px-4 py-4 text-right">{post.metrics.replies}</td>
              <td className="px-4 py-4">
                <button 
                  onClick={() => handleDelete(post.id)}
                  className="rounded-md px-3 py-1 text-xs text-red-500 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {posts.length === 0 && (
            <tr>
              <td
                colSpan={10}
                className="px-4 py-6 text-center text-sm text-muted-foreground"
              >
                No posts found for the selected filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}