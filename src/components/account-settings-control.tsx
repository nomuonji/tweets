'use client';

import { useState } from 'react';
import type { AccountDoc } from '@/lib/types';

type AccountSettingsControlProps = {
  account: AccountDoc;
  onAccountUpdate: (accountId: string, updatedData: Partial<AccountDoc>) => void;
};

export function AccountSettingsControl({ account, onAccountUpdate }: AccountSettingsControlProps) {
  const [concept, setConcept] = useState(account.concept ?? '');
  const [autoPostEnabled, setAutoPostEnabled] = useState(account.autoPostEnabled ?? false);
  const [postSchedule, setPostSchedule] = useState(account.postSchedule ?? Array(5).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleScheduleChange = (index: number, value: string) => {
    const newSchedule = [...postSchedule];
    newSchedule[index] = value;
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
            {Array.from({ length: 5 }).map((_, index) => (
              <input
                key={index}
                type="time"
                value={postSchedule[index] ?? ''}
                onChange={(e) => handleScheduleChange(index, e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
              />
            ))}
          </div>
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
