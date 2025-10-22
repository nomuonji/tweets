'use client';

import { useState, useEffect, FormEvent, useCallback } from 'react';
import type { ExemplaryPost } from '@/lib/types';

type ExemplaryPostManagerProps = {
  selectedAccountId: string | null;
};

export function ExemplaryPostManager({ selectedAccountId }: ExemplaryPostManagerProps) {
  const [posts, setPosts] = useState<ExemplaryPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [currentPost, setCurrentPost] = useState<Partial<ExemplaryPost> | null>(null);

  const fetchPosts = useCallback(async () => {
    if (!selectedAccountId) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${selectedAccountId}/exemplary-posts`);
      const data = await response.json();
      if (data.ok) {
        setPosts(data.posts);
      } else {
        throw new Error(data.message || 'Failed to fetch exemplary posts.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedAccountId) {
      fetchPosts();
    } else {
      setPosts([]);
    }
  }, [selectedAccountId, fetchPosts]);

  const handleEdit = (post: ExemplaryPost) => {
    setCurrentPost(post);
    setIsEditing(true);
  };

  const handleAddNew = () => {
    setCurrentPost({ text: '', explanation: '' });
    setIsEditing(true);
  };

  const handleCancel = () => {
    setCurrentPost(null);
    setIsEditing(false);
  };

  const handleDelete = async (id: string) => {
    if (!selectedAccountId) return;
    if (confirm('Are you sure you want to delete this post?')) {
      try {
        const response = await fetch(`/api/accounts/${selectedAccountId}/exemplary-posts/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.ok) {
          fetchPosts();
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
    if (!currentPost || !selectedAccountId) return;

    const url = currentPost.id ? `/api/accounts/${selectedAccountId}/exemplary-posts/${currentPost.id}` : `/api/accounts/${selectedAccountId}/exemplary-posts`;
    const method = currentPost.id ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentPost.text, explanation: currentPost.explanation }),
      });
      const data = await response.json();
      if (data.ok) {
        handleCancel();
        fetchPosts();
      } else {
        throw new Error(data.message || 'Failed to save post.');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!selectedAccountId) {
    return null; // Or a message asking to select an account
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Exemplary Posts</h2>
      <p className="text-sm text-muted-foreground">Manage exemplary posts for the selected account to guide AI generation.</p>
      
      {isLoading && <p>Loading posts...</p>}
      {error && <p className="text-red-500">Error: {error}</p>}

      {isEditing && currentPost ? (
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div>
            <label htmlFor="text" className="block text-sm font-medium">Post Text</label>
            <textarea id="text" rows={4} value={currentPost.text || ''} onChange={(e) => setCurrentPost({ ...currentPost, text: e.target.value })} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required />
          </div>
          <div>
            <label htmlFor="explanation" className="block text-sm font-medium">Explanation (What to learn from this)</label>
            <textarea id="explanation" rows={3} value={currentPost.explanation || ''} onChange={(e) => setCurrentPost({ ...currentPost, explanation: e.target.value })} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required />
          </div>
          <div className="flex justify-end space-x-2">
            <button type="button" onClick={handleCancel} className="px-4 py-2 border rounded-md text-sm">Cancel</button>
            <button type="submit" className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm text-white bg-indigo-600 hover:bg-indigo-700">Save Post</button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={handleAddNew} className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Add New Post</button>
          </div>
          {posts.map((post) => (
            <div key={post.id} className="p-4 border rounded-md bg-background">
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{post.text}</p>
              <p className="mt-2 text-xs text-gray-500 italic border-l-2 border-gray-300 pl-2">Explanation: {post.explanation}</p>
              <div className="mt-3 flex justify-end space-x-2">
                <button onClick={() => handleEdit(post)} className="px-3 py-1 border rounded-md text-sm">Edit</button>
                <button onClick={() => handleDelete(post.id)} className="px-3 py-1 border rounded-md text-sm text-white bg-red-600 hover:bg-red-700">Delete</button>
              </div>
            </div>
          ))}
          {!isLoading && posts.length === 0 && <p className="text-sm text-muted-foreground">No exemplary posts found for this account.</p>}
        </div>
      )}
    </div>
  );
}
