'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Tip } from '@/lib/types';

export default function TipsPage() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [currentTip, setCurrentTip] = useState<Partial<Tip> | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    fetchTips();
  }, []);

  const fetchTips = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/tips');
      const data = await response.json();
      if (data.ok) {
        setTips(data.tips);
      } else {
        throw new Error(data.message || 'Failed to fetch tips.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (tip: Tip) => {
    setCurrentTip(tip);
    setIsEditing(true);
  };

  const handleAddNew = () => {
    setCurrentTip({ title: '', content: '' });
    setIsEditing(true);
  };

  const handleCancel = () => {
    setCurrentTip(null);
    setIsEditing(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this tip?')) {
      try {
        const response = await fetch(`/api/tips/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.ok) {
          fetchTips(); // Refresh the list
        } else {
          throw new Error(data.message || 'Failed to delete tip.');
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
        body: JSON.stringify({ title: currentTip.title, content: currentTip.content }),
      });
      const data = await response.json();
      if (data.ok) {
        handleCancel();
        fetchTips();
      } else {
        throw new Error(data.message || 'Failed to save tip.');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error} <button onClick={fetchTips}>Retry</button></div>;

  if (isEditing && currentTip) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">{currentTip.id ? 'Edit Tip' : 'Add New Tip'}</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700">Title</label>
            <input
              id="title"
              type="text"
              value={currentTip.title || ''}
              onChange={(e) => setCurrentTip({ ...currentTip, title: e.target.value })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="content" className="block text-sm font-medium text-gray-700">Content</label>
            <textarea
              id="content"
              rows={6}
              value={currentTip.content || ''}
              onChange={(e) => setCurrentTip({ ...currentTip, content: e.target.value })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              required
            />
          </div>
          <div className="flex justify-end space-x-2">
            <button type="button" onClick={handleCancel} className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
            <button type="submit" className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Save Tip</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Manage Tips</h1>
        <button onClick={handleAddNew} className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Add New Tip</button>
      </div>
      <div className="space-y-4">
        {tips.map((tip) => (
          <div key={tip.id} className="p-4 border rounded-md shadow-sm">
            <h2 className="text-lg font-semibold">{tip.title}</h2>
            <p className="mt-2 text-gray-600 whitespace-pre-wrap">{tip.content}</p>
            <div className="mt-4 flex justify-end space-x-2">
              <button onClick={() => handleEdit(tip)} className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Edit</button>
              <button onClick={() => handleDelete(tip.id)} className="px-3 py-1 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
