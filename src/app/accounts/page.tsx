'use client';

import { useState, useEffect } from 'react';
import Link from "next/link";
import type { AccountDoc, Tip } from "@/lib/types";
import { toTitleCase } from '@/lib/utils';
import { TipsSelectionModal } from '@/components/tips-selection-modal';

export default function AccountsIndexPage() {
  const [accounts, setAccounts] = useState<AccountDoc[]>([]);
  const [allTips, setAllTips] = useState<Tip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  
  const [selectedAccount, setSelectedAccount] = useState<AccountDoc | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [accountsRes, tipsRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/tips'),
      ]);
      const accountsData = await accountsRes.json();
      const tipsData = await tipsRes.json();

      if (!accountsData.ok) throw new Error(accountsData.message || 'Failed to fetch accounts.');
      if (!tipsData.ok) throw new Error(tipsData.message || 'Failed to fetch tips.');

      setAccounts(accountsData.accounts.sort((a: AccountDoc, b: AccountDoc) => a.handle.localeCompare(b.handle)));
      setAllTips(tipsData.tips);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (account: AccountDoc) => {
    setSelectedAccount(account);
  };

  const handleCloseModal = () => {
    setSelectedAccount(null);
  };

  const handleSaveTips = async (updatedTipIds: string[]) => {
    if (!selectedAccount) return;

    try {
      const response = await fetch(`/api/accounts/${selectedAccount.id}/tips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTipIds: updatedTipIds }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || 'Failed to update tips.');
      
      // Update local state to reflect changes immediately
      setAccounts(prev => 
        prev.map(acc => 
          acc.id === selectedAccount.id ? { ...acc, selectedTipIds: updatedTipIds } : acc
        )
      );
      handleCloseModal();
    } catch (err) {
      setError((err as Error).message); // Show error to user
    }
  };

  const handleSaveSettings = async (accountId: string) => {
    const concept = (document.getElementById(`concept-${accountId}`) as HTMLTextAreaElement).value;
    const autoPostEnabled = (document.getElementById(`autoPostEnabled-${accountId}`) as HTMLInputElement).checked;
    const postSchedule: string[] = [];
    for (let i = 0; i < 5; i++) {
      const timeInput = document.getElementById(`postSchedule-${accountId}-${i}`) as HTMLInputElement;
      if (timeInput.value) {
        postSchedule.push(timeInput.value);
      }
    }

    try {
      const response = await fetch(`/api/accounts/${accountId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concept, autoPostEnabled, postSchedule }),
        });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message || 'Failed to update settings.');

      setAccounts(prev =>
        prev.map(acc =>
          acc.id === accountId ? { ...acc, concept, autoPostEnabled, postSchedule } : acc
        )
      );
      setEditingAccountId(null); // Close the form
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (isLoading) return <div className="text-center p-8">Loading accounts...</div>;
  if (error) return <div className="rounded-xl border border-destructive bg-destructive/10 p-4 text-sm text-destructive">Error: {error} <button onClick={fetchData} className="font-semibold underline">Retry</button></div>;

  return (
    <div className="space-y-8">
      {selectedAccount && (
        <TipsSelectionModal 
          account={selectedAccount}
          allTips={allTips}
          onClose={handleCloseModal}
          onSave={handleSaveTips}
        />
      )}

      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">アカウント一覧</h1>
          <p className="text-sm text-muted-foreground">
            接続済みアカウントの接続状況や生成に利用するTipsを設定できます。
          </p>
        </div>
        <Link
          href="/accounts/connect"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          新しいアカウントを連携
        </Link>
      </header>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted-foreground">
          接続済みのアカウントがまだありません。<Link href="/accounts/connect" className="text-primary underline">アカウント連携ページ</Link>から追加してください。
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="rounded-xl border border-border bg-surface p-6 shadow-sm"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {toTitleCase(account.platform)}
                  </p>
                  <h2 className="text-xl font-semibold">@{account.handle}</h2>
                  <p className="text-sm text-muted-foreground">
                    {account.concept || "コンセプト未設定"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold ${
                      account.connected
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {account.connected ? "Connected" : "Disconnected"}
                  </span>
                  <button
                    onClick={() => setEditingAccountId(editingAccountId === account.id ? null : account.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 font-medium text-muted-foreground hover:text-primary hover:bg-gray-50"
                  >
                    設定
                  </button>
                  <button
                    onClick={() => handleOpenModal(account)}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 font-medium text-muted-foreground hover:text-primary hover:bg-gray-50"
                  >
                    Tips設定 ({account.selectedTipIds?.length || 0})
                  </button>
                  <Link
                    href={`/accounts/connect?handle=${encodeURIComponent(account.handle)}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 font-medium text-muted-foreground hover:text-primary hover:bg-gray-50"
                  >
                    接続を更新
                  </Link>
                </div>
              </div>
              {editingAccountId === account.id && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor={`concept-${account.id}`} className="block text-sm font-medium text-muted-foreground">コンセプト</label>
                    <textarea
                      id={`concept-${account.id}`}
                      defaultValue={account.concept}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        id={`autoPostEnabled-${account.id}`}
                        defaultChecked={account.autoPostEnabled}
                        className="rounded border-gray-300 text-primary shadow-sm focus:border-primary focus:ring-primary"
                      />
                      <span className="ml-2 text-sm text-muted-foreground">自動投稿を有効にする</span>
                    </label>
                  </div>
                  <div>
                    <label htmlFor={`postSchedule-${account.id}`} className="block text-sm font-medium text-muted-foreground">投稿スケジュール</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mt-1">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <input
                          key={index}
                          type="time"
                          id={`postSchedule-${account.id}-${index}`}
                          defaultValue={account.postSchedule?.[index] ?? ''}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSaveSettings(account.id)}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
