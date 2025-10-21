'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import type { AccountDoc, Tip } from '@/lib/types';
import { toTitleCase } from '@/lib/utils';
import { TipsSelectionModal } from '@/components/tips-selection-modal';

export default function AccountsIndexPage() {
  const [accounts, setAccounts] = useState<AccountDoc[]>([]);
  const [allTips, setAllTips] = useState<Tip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}