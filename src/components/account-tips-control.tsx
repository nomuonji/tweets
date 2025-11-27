'use client';

import { useState, useEffect } from 'react';
import type { AccountDoc, Tip } from '@/lib/types';

type AccountTipsControlProps = {
  account: AccountDoc | null;
  onAccountUpdate: (accountId: string, updatedData: Partial<AccountDoc>) => void;
};

export function AccountTipsControl({ account, onAccountUpdate }: AccountTipsControlProps) {
  const [tips, setTips] = useState<Tip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTipIds, setSelectedTipIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // Fetch tips only once
  useEffect(() => {
    const fetchTips = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/tips`); // Fetch all available tips
        const data = await res.json();
        if (data.ok) {
          setTips(data.tips);
        }
      } catch (err) {
        console.error("Failed to load tips", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTips();
  }, []);

  // Update selection when account changes
  useEffect(() => {
    if (account) {
      setSelectedTipIds(new Set(account.selectedTipIds || []));
    } else {
      setSelectedTipIds(new Set());
    }
  }, [account]);

  const toggleTip = (tipId: string) => {
    const newSet = new Set(selectedTipIds);
    if (newSet.has(tipId)) {
      newSet.delete(tipId);
    } else {
      newSet.add(tipId);
    }
    setSelectedTipIds(newSet);
  };

  const handleSave = async () => {
    if (!account) return;
    setIsSaving(true);
    const newSelectedIds = Array.from(selectedTipIds);
    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTipIds: newSelectedIds }),
      });
      if (response.ok) {
        onAccountUpdate(account.id, { selectedTipIds: newSelectedIds });
      }
    } catch (err) {
      alert("Failed to save tips selection.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!account) return null;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm relative">
       <div className="absolute inset-0 z-10 bg-surface/60 flex items-center justify-center rounded-xl cursor-not-allowed">
        <div className="rounded-md bg-secondary px-4 py-2 font-semibold shadow-sm text-secondary-foreground">
          Currently Suspended (Use Account Concept)
        </div>
      </div>
      <div className="opacity-50 pointer-events-none">
        <div>
          <h2 className="text-lg font-semibold">Active Tips</h2>
          <p className="text-sm text-muted-foreground">Select tips to include in the prompt context.</p>
        </div>

        {isLoading ? <p>Loading tips...</p> : (
          <div className="max-h-60 overflow-y-auto space-y-2 border border-border rounded-md p-2">
            {tips.length === 0 ? <p className="text-sm text-muted-foreground">No tips available in the library.</p> : (
              tips.map(tip => (
                <label key={tip.id} className="flex items-start gap-2 p-2 hover:bg-muted rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTipIds.has(tip.id)}
                    onChange={() => toggleTip(tip.id)}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-medium">{tip.text}</p>
                    <p className="text-xs text-muted-foreground">@{tip.author_handle}</p>
                  </div>
                </label>
              ))
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Update Selection"}
          </button>
        </div>
      </div>
    </div>
  );
}
