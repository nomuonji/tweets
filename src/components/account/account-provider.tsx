"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AccountDoc } from "@/lib/types";

type AccountContextValue = {
  accounts: AccountDoc[];
  selectedAccountId: string | null;
  selectedAccount: AccountDoc | null;
  setSelectedAccountId: (id: string) => void;
};

const AccountContext = createContext<AccountContextValue | undefined>(undefined);

type AccountProviderProps = {
  accounts: AccountDoc[];
  children: React.ReactNode;
};

const STORAGE_KEY = "selected-account-id";

export function AccountProvider({ accounts, children }: AccountProviderProps) {
  const sanitizedAccounts = useMemo(
    () =>
      accounts
        .filter((account) => Boolean(account?.id))
        .map((account) => ({ ...account })),
    [accounts],
  );

  const firstAccountId = sanitizedAccounts[0]?.id ?? null;

  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return firstAccountId;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && sanitizedAccounts.some((account) => account.id === stored)) {
      return stored;
    }
    return firstAccountId;
  });

  useEffect(() => {
    if (!selectedAccountId && firstAccountId) {
      setSelectedAccountIdState(firstAccountId);
    }
    if (
      selectedAccountId &&
      sanitizedAccounts.every((account) => account.id !== selectedAccountId)
    ) {
      setSelectedAccountIdState(firstAccountId);
    }
  }, [selectedAccountId, sanitizedAccounts, firstAccountId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selectedAccountId) {
      window.localStorage.setItem(STORAGE_KEY, selectedAccountId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedAccountId]);

  const setSelectedAccountId = useCallback((id: string) => {
    setSelectedAccountIdState(id);
  }, []);

  const selectedAccount = useMemo(
    () =>
      selectedAccountId
        ? sanitizedAccounts.find((account) => account.id === selectedAccountId) ?? null
        : null,
    [sanitizedAccounts, selectedAccountId],
  );

  const value = useMemo(
    () => ({
      accounts: sanitizedAccounts,
      selectedAccountId,
      selectedAccount,
      setSelectedAccountId,
    }),
    [sanitizedAccounts, selectedAccountId, selectedAccount, setSelectedAccountId],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountContext() {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error("useAccountContext must be used within an AccountProvider");
  }
  return context;
}
