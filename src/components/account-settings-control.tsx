'use client';

import { useState, useEffect } from 'react';
import type { AccountDoc } from '@/lib/types';

type AccountSettingsControlProps = {
  account: AccountDoc;
  onAccountUpdate: (accountId: string, updatedData: Partial<AccountDoc>) => void;
};

export function AccountSettingsControl({ account, onAccountUpdate }: AccountSettingsControlProps) {
  const [concept, setConcept] = useState(account.concept ?? '');
  const [autoPostEnabled, setAutoPostEnabled] = useState(account.autoPostEnabled ?? false);
  const [postSchedule, setPostSchedule] = useState<string[]>(
    account.postSchedule && account.postSchedule.length > 0 ? account.postSchedule : ['']
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setConcept(account.concept ?? '');
    setAutoPostEnabled(account.autoPostEnabled ?? false);
    setPostSchedule(account.postSchedule && account.postSchedule.length > 0 ? account.postSchedule : ['']);
    setError(null);
    setIsSaving(false);
  }, [account]);

  const handleScheduleChange = (index: number, value: string) => {
    const newSchedule = [...postSchedule];
    newSchedule[index] = value;
    setPostSchedule(newSchedule);
  };

  const addScheduleSlot = () => {
    setPostSchedule([...postSchedule, '']);
  };

  const removeScheduleSlot = (index: number) => {
    if (postSchedule.length <= 1) return; // Prevent removing the last input
    const newSchedule = postSchedule.filter((_, i) => i !== index);
    setPostSchedule(newSchedule);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    const updatedData = {
      concept,
      autoPostEnabled,
      postSchedule: postSchedule.filter(t => t), // remove empty strings
    };

    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || 'Failed to update settings.');

      onAccountUpdate(account.id, updatedData);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Account Settings</h2>
        <p className="text-sm text-muted-foreground">Configure the behavior of this account.</p>
      </div>
      <div className="space-y-4">
        <div>
          <label htmlFor={`concept-${account.id}`} className="block text-sm font-medium text-muted-foreground">Concept</label>
          <textarea
            id={`concept-${account.id}`}
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
            rows={3}
            placeholder="e.g., A bot that posts about the weather in Tokyo."
          />
        </div>
        <div>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={autoPostEnabled}
              onChange={(e) => setAutoPostEnabled(e.target.checked)}
              className="rounded border-gray-300 text-primary shadow-sm focus:border-primary focus:ring-primary"
            />
            <span className="ml-2 text-sm text-muted-foreground">Enable auto-posting</span>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground">Post Schedule</label>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mt-1">
            {postSchedule.map((time, index) => (
              <div key={index} className="flex items-center gap-1">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => handleScheduleChange(index, e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
                {postSchedule.length > 1 && (
                  <button
                    onClick={() => removeScheduleSlot(index)}
                    className="p-1 text-red-500 rounded-full hover:bg-red-100"
                    aria-label="Remove schedule time"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addScheduleSlot}
            className="mt-2 rounded-md bg-secondary px-3 py-1 text-xs text-secondary-foreground transition hover:opacity-90"
          >
            + Add Time
          </button>
        </div>
        <div className="flex justify-end gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
