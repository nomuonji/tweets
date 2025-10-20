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
  initialSelectedAccountId?: string | null;
  children: React.ReactNode;
};

const STORAGE_KEY = "selected-account-id";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function readCookieValue(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const pattern = new RegExp(`(?:^|; )${name}=([^;]*)`);
  const match = document.cookie.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookieValue(name: string, value: string | null) {
  if (typeof document === "undefined") {
    return;
  }
  if (value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; sameSite=Lax`;
  } else {
    document.cookie = `${name}=; path=/; max-age=0; sameSite=Lax`;
  }
}

export function AccountProvider({
  accounts,
  initialSelectedAccountId,
  children,
}: AccountProviderProps) {
  const sanitizedAccounts = useMemo(
    () =>
      accounts
        .filter((account) => Boolean(account?.id))
        .map((account) => ({ ...account })),
    [accounts],
  );

  const firstAccountId = sanitizedAccounts[0]?.id ?? null;

  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(
    () => {
      if (typeof window === "undefined") {
        return initialSelectedAccountId ?? firstAccountId;
      }

      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && sanitizedAccounts.some((account) => account.id === stored)) {
        return stored;
      }

      const cookieValue = readCookieValue(STORAGE_KEY);
      if (cookieValue && sanitizedAccounts.some((account) => account.id === cookieValue)) {
        return cookieValue;
      }

      return initialSelectedAccountId ?? firstAccountId;
    },
  );

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
      writeCookieValue(STORAGE_KEY, selectedAccountId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
      writeCookieValue(STORAGE_KEY, null);
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
