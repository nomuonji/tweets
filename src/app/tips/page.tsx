'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Tip, AccountDoc, Platform } from '@/lib/types';

export default function TipsPage() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [accounts, setAccounts] = useState<AccountDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [postUrl, setPostUrl] = useState('');
  const [isFetchingPost, setIsFetchingPost] = useState(false);
  const [currentTip, setCurrentTip] = useState<Partial<Tip> | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    fetchTipsAndAccounts();
  }, []);

  const fetchTipsAndAccounts = async () => {
    try {
      setIsLoading(true);
      const [tipsResponse, accountsResponse] = await Promise.all([
        fetch('/api/tips'),
        fetch('/api/accounts'),
      ]);
      const tipsData = await tipsResponse.json();
      const accountsData = await accountsResponse.json();

      if (tipsData.ok) {
        setTips(tipsData.tips);
      } else {
        throw new Error(tipsData.message || 'Failed to fetch tips.');
      }

      if (accountsData.ok) {
        setAccounts(accountsData.accounts);
      } else {
        throw new Error(accountsData.message || 'Failed to fetch accounts.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchPost = async () => {
    if (!postUrl) return;
    setIsFetchingPost(true);
    setError(null);
    try {
      const response = await fetch('/api/scrape-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: postUrl }),
      });

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.message || 'Failed to fetch post data.');
      }

      const { post } = data;
      setCurrentTip({
        url: post.url,
        platform: post.platform,
        author_handle: post.author_handle,
        text: post.text,
        title: post.text.substring(0, 40),
        account_ids: [],
      });
      setIsEditing(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsFetchingPost(false);
      setPostUrl('');
    }
  };

  const handleManualAdd = () => {
    setCurrentTip({
      text: '',
      account_ids: [],
    });
    setIsEditing(true);
  };

  const handleEdit = (tip: Tip) => {
    setCurrentTip(tip);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setCurrentTip(null);
    setIsEditing(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this reference post?')) {
      try {
        const response = await fetch(`/api/tips/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.ok) {
          fetchTipsAndAccounts();
        } else {
          throw new Error(data.message || 'Failed to delete post.');
        }
      } catch (err) {
        setError((err as Error).message);
      }
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentTip) return;

    const url = isEditing && currentTip.id ? `/api/tips/${currentTip.id}` : '/api/tips';
    const method = isEditing && currentTip.id ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentTip),
      });
      const data = await response.json();
      if (data.ok) {
        handleCancel();
        fetchTipsAndAccounts();
      } else {
        throw new Error(data.message || 'Failed to save post.');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAccountSelection = (accountId: string) => {
    if (!currentTip) return;
    const currentIds = currentTip.account_ids || [];
    const newIds = currentIds.includes(accountId)
      ? currentIds.filter(id => id !== accountId)
      : [...currentIds, accountId];
    setCurrentTip({ ...currentTip, account_ids: newIds });
  };

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error} <button onClick={fetchTipsAndAccounts}>Retry</button></div>;

  if (isEditing && currentTip) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">{currentTip.id ? 'Edit Reference Post' : 'Add New Reference Post'}</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {currentTip.url && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Post URL</label>
              <p className="mt-1 text-sm text-gray-900">{currentTip.url}</p>
            </div>
          )}
          <div>
            <label htmlFor="text" className="block text-sm font-medium text-gray-700">Tip Text</label>
            <textarea
              id="text"
              rows={6}
              value={currentTip.text || ''}
              onChange={(e) => setCurrentTip({ ...currentTip, text: e.target.value })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="author_handle" className="block text-sm font-medium text-gray-700">Author Handle</label>
              <input
                type="text"
                id="author_handle"
                value={currentTip.author_handle || ''}
                onChange={(e) => setCurrentTip({ ...currentTip, author_handle: e.target.value })}
                disabled={!!currentTip.url}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:bg-gray-100"
              />
            </div>
            <div>
              <label htmlFor="platform" className="block text-sm font-medium text-gray-700">Platform</label>
              <select
                id="platform"
                value={currentTip.platform || ''}
                onChange={(e) => setCurrentTip({ ...currentTip, platform: e.target.value as Platform })}
                disabled={!!currentTip.url}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:bg-gray-100"
              >
                <option value="">Select Platform</option>
                <option value="x">X</option>
                <option value="threads">Threads</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Associate with Accounts</label>
            <div className="mt-2 space-y-2">
              {accounts.map(account => (
                <div key={account.id} className="flex items-center">
                  <input
                    id={`account-${account.id}`}
                    type="checkbox"
                    checked={currentTip.account_ids?.includes(account.id) || false}
                    onChange={() => handleAccountSelection(account.id)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor={`account-${account.id}`} className="ml-3 block text-sm font-medium text-gray-700">
                    @{account.handle} ({account.platform})
                  </label>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <button type="button" onClick={handleCancel} className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
            <button type="submit" className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Save Post</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Manage Reference Posts</h1>
      </div>
      <div className="mb-6 p-4 border rounded-md">
        <label htmlFor="postUrl" className="block text-sm font-medium text-gray-700">Add Post by URL</label>
        <div className="mt-1 flex rounded-md shadow-sm">
          <input
            type="url"
            id="postUrl"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            className="block w-full flex-1 rounded-none rounded-l-md border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="https://x.com/user/status/123..."
          />
          <button
            onClick={handleFetchPost}
            disabled={isFetchingPost}
            className="inline-flex items-center rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {isFetchingPost ? 'Fetching...' : 'Fetch & Add'}
          </button>
        </div>
        <div className="mt-4">
          <button
            onClick={handleManualAdd}
            className="inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            Add Tip Manually
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {tips.map((tip) => (
          <div key={tip.id} className="p-4 border rounded-md shadow-sm">
            <p className="text-sm text-gray-500">@{tip.author_handle} on {tip.platform}</p>
            <p className="mt-2 text-gray-800 whitespace-pre-wrap">{tip.text}</p>
            <div className="mt-2">
              <span className="text-xs font-semibold">Used by: </span>
              {tip.account_ids && tip.account_ids.length > 0 ? (
                tip.account_ids.map(id => {
                  const acc = accounts.find(a => a.id === id);
                  return <span key={id} className="ml-1 inline-block bg-gray-200 rounded-full px-2 py-1 text-xs font-semibold text-gray-700">@{acc?.handle}</span>;
                })
              ) : (
                <span className="text-xs text-gray-500">Not associated with any account.</span>
              )}
            </div>
            <div className="mt-4 flex justify-end space-x-2">
              <a href={tip.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">View Post</a>
              <button onClick={() => handleEdit(tip)} className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Edit</button>
              <button onClick={() => handleDelete(tip.id)} className="px-3 py-1 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}