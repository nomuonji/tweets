'use client';

import { useState } from 'react';
import type { AccountDoc, Tip } from '@/lib/types';
import { TipsSelectionModal } from './tips-selection-modal';

type AccountTipsControlProps = {
  account: AccountDoc;
  allTips: Tip[];
  onTipsUpdate: (accountId: string, updatedTipIds: string[]) => void;
};

export function AccountTipsControl({ account, allTips, onTipsUpdate }: AccountTipsControlProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSave = async (updatedTipIds: string[]) => {
    try {
      const response = await fetch(`/api/accounts/${account.id}/tips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTipIds: updatedTipIds }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || 'Failed to update tips.');
      
      onTipsUpdate(account.id, updatedTipIds);
      setIsModalOpen(false);
    } catch (err) {
      // In a real app, you'd show this error to the user
      console.error("Failed to save tips:", err);
    }
  };

  const selectedTips = allTips.filter(tip => account.selectedTipIds?.includes(tip.id));

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      {isModalOpen && (
        <TipsSelectionModal 
          account={account}
          allTips={allTips}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
        />
      )}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Applied Tips</h2>
          <p className="text-sm text-muted-foreground">General principles guiding the AI generation for this account.</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="px-4 py-2 border rounded-md text-sm font-medium">Edit</button>
      </div>
      <div className="mt-4">
        {selectedTips.length > 0 ? (
          <ul className="space-y-2">
            {selectedTips.map(tip => (
              <li key={tip.id} className="text-sm p-2 bg-background rounded-md">{tip.title}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No tips selected. Use the Edit button to apply generation tips.</p>
        )}
      </div>
    </div>
  );
}
