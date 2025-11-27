'use client';

import { useState, useEffect } from 'react';
import type { ExemplaryPost } from '@/lib/types';

type ExemplaryPostManagerProps = {
  selectedAccountId: string | null;
};

export function ExemplaryPostManager({ selectedAccountId }: ExemplaryPostManagerProps) {
  const [posts, setPosts] = useState<ExemplaryPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [explanation, setExplanation] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!selectedAccountId) return;
    const fetchPosts = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/accounts/${selectedAccountId}/exemplary-posts`);
        const data = await res.json();
        if (data.ok) {
          setPosts(data.posts);
        } else {
          setError(data.message);
        }
      } catch (err) {
        console.error(err);
        setError("Failed to load exemplary posts.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchPosts();
  }, [selectedAccountId]);

  const handleAdd = async () => {
    if (!selectedAccountId || !text || !explanation) return;
    setIsAdding(true);
    try {
      const res = await fetch(`/api/accounts/${selectedAccountId}/exemplary-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, explanation, platform: 'x' }),
      });
      const data = await res.json();
      if (data.ok) {
        setPosts([data.post, ...posts]);
        setText('');
        setExplanation('');
      } else {
        alert(data.message);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to add post.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!selectedAccountId || !confirm("Delete this exemplary post?")) return;
    try {
      const res = await fetch(`/api/accounts/${selectedAccountId}/exemplary-posts?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setPosts(posts.filter(p => p.id !== id));
      } else {
        alert("Failed to delete.");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  if (!selectedAccountId) return null;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm relative">
      <div>
        <div>
          <h2 className="text-lg font-semibold">Exemplary Posts</h2>
          <p className="text-sm text-muted-foreground">Add examples of the style you want to emulate.</p>
        </div>

        <div className="space-y-2">
          <textarea
            placeholder="Post text..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm p-2"
          />
          <textarea
            placeholder="Why is this good? (Reasoning)"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm p-2"
          />
          <button
            onClick={handleAdd}
            disabled={isAdding || !text || !explanation}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            {isAdding ? "Adding..." : "Add Example"}
          </button>
        </div>

        {isLoading && <p>Loading...</p>}
        {error && <p className="text-red-500">{error}</p>}

        <ul className="space-y-3">
          {posts.map(post => (
            <li key={post.id} className="rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-medium">{post.text}</p>
              <p className="text-xs text-muted-foreground mt-1">Reasoning: {post.explanation}</p>
              <button onClick={() => handleDelete(post.id)} className="mt-2 text-xs text-red-500 hover:underline">
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
