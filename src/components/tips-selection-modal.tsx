'use client';

import { useState } from 'react';
import type { AccountDoc, Tip } from '@/lib/types';

export function TipsSelectionModal({
  account,
  allTips,
  onClose,
  onSave,
}: {
  account: AccountDoc;
  allTips: Tip[];
  onClose: () => void;
  onSave: (updatedTipIds: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(account.selectedTipIds || []);
  const [isSaving, setIsSaving] = useState(false);

  const handleCheckboxChange = (tipId: string) => {
    setSelectedIds(prev => 
      prev.includes(tipId) ? prev.filter(id => id !== tipId) : [...prev, tipId]
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(selectedIds);
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Select Tips for @{account.handle}</h2>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {allTips.map(tip => (
            <label key={tip.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100">
              <input
                type="checkbox"
                checked={selectedIds.includes(tip.id)}
                onChange={() => handleCheckboxChange(tip.id)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-medium">{tip.title}</span>
            </label>
          ))}
        </div>
        <div className="mt-6 flex justify-end space-x-2">
          <button onClick={onClose} disabled={isSaving} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
