"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccountContext } from "./account-provider";
import { cn, platformLabel } from "@/lib/utils";
import { PlusIcon } from "@/components/ui/icons";

/**
 * The app's single source of truth for "which account am I working on".
 * Rendered once in the sidebar — pages read `useAccountContext()` rather than
 * shipping their own picker.
 */
export function AccountSwitcher() {
  const { accounts, selectedAccountId, setSelectedAccountId, selectedAccount } =
    useAccountContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (accounts.length === 0) {
    return (
      <Link
        href="/accounts/connect"
        className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <PlusIcon className="h-4 w-4" />
        アカウントを連携
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
        運用アカウント
      </p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover"
      >
        <AccountAvatar handle={selectedAccount?.handle ?? "?"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            @{selectedAccount?.handle ?? "未選択"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {selectedAccount ? platformLabel(selectedAccount.platform) : "—"}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg animate-scale-in"
        >
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccountId;
            return (
              <button
                key={account.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setSelectedAccountId(account.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left transition-colors",
                  isSelected ? "bg-surface-active" : "hover:bg-surface-hover",
                )}
              >
                <AccountAvatar handle={account.handle} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    @{account.handle}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {platformLabel(account.platform)}
                    {account.display_name ? ` · ${account.display_name}` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    account.autoPostEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  自動投稿 {account.autoPostEnabled ? "ON" : "OFF"}
                </span>
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    account.connected ? "bg-success" : "bg-muted-foreground/40",
                  )}
                  title={account.connected ? "接続中" : "未接続"}
                />
              </button>
            );
          })}
          <Link
            href="/accounts/connect"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 border-t border-border px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <PlusIcon className="h-4 w-4" />
            アカウントを追加
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function AccountAvatar({ handle }: { handle: string }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold uppercase text-primary"
      aria-hidden="true"
    >
      {handle.slice(0, 2)}
    </span>
  );
}
