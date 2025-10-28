'use client';

import { useState, useEffect } from 'react';
import type { Tip, AccountDoc } from '@/lib/types';

type AccountTipsControlProps = {
  account: AccountDoc | null;
  onAccountUpdate: (accountId: string, updatedData: Partial<AccountDoc>) => void;
};

export function AccountTipsControl({ account, onAccountUpdate }: AccountTipsControlProps) {
  const [allTips, setAllTips] = useState<Tip[]>([]);
  const [selectedTipIds, setSelectedTipIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAllTips() {
      try {
        setIsLoading(true);
        const response = await fetch('/api/tips');
        const data = await response.json();
        if (data.ok) {
          setAllTips(data.tips);
        } else {
          throw new Error(data.message || 'Failed to fetch tips.');
        }
      } catch (err) {
        setError((err as Error).message);
      }
    }

    fetchAllTips();
  }, []);

  useEffect(() => {
    if (account?.selectedTipIds) {
      setSelectedTipIds(new Set(account.selectedTipIds));
    } else {
      setSelectedTipIds(new Set());
    }
    // Stop loading only when account is loaded
    if (account) {
        setIsLoading(false);
    }
  }, [account]);

  const handleToggle = (tipId: string) => {
    const newSelection = new Set(selectedTipIds);
    if (newSelection.has(tipId)) {
      newSelection.delete(tipId);
    } else {
      newSelection.add(tipId);
    }
    setSelectedTipIds(newSelection);
  };

  const handleSave = async () => {
    if (!account) return;
    setIsSaving(true);
    setError(null);

    const updatedData = { 
      selectedTipIds: Array.from(selectedTipIds)
    };

    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || 'Failed to update tips selection.');
      
      onAccountUpdate(account.id, updatedData);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!account) {
    return (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm animate-pulse">
            <div className="h-6 bg-muted rounded w-1/3"></div>
            <div className="h-4 bg-muted rounded w-2/3"></div>
        </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Account-specific Tips</h2>
        <p className="text-sm text-muted-foreground">Select which global tips to apply to this account.</p>
      </div>
      
      {isLoading && <p>Loading tips...</p>}
      {error && <p className="text-red-500">Error: {error}</p>}

      <div className="max-h-60 space-y-2 overflow-y-auto pr-2">
        {allTips.map((tip) => (
          <label key={tip.id} className="flex items-center justify-between rounded-md bg-background p-3 hover:bg-surface-hover">
            <div className="flex items-start gap-3">
                <input
                type="checkbox"
                checked={selectedTipIds.has(tip.id)}
                onChange={() => handleToggle(tip.id)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div>
                    <span className="block text-sm font-medium">{tip.title}</span>
                    <span className="block text-xs text-muted-foreground">{tip.text}</span>
                </div>
            </div>
            <a href={tip.url} target="_blank" rel="noopener noreferrer" className="ml-4 text-xs text-primary hover:underline">Source</a>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Tips Selection'}
        </button>
      </div>
    </div>
  );
}
