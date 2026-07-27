"use client";

import { useState } from "react";
import Link from "next/link";
import type { AccountDoc } from "@/lib/types";
import { AccountProvider } from "@/components/account/account-provider";
import { AccountSwitcher } from "@/components/account/account-switcher";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { MenuIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { SideNav } from "./side-nav";

type AppShellProps = {
  children: React.ReactNode;
  accounts: AccountDoc[];
  initialSelectedAccountId?: string | null;
};

export function AppShell({
  children,
  accounts,
  initialSelectedAccountId,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <body className="min-h-screen bg-background text-foreground antialiased">
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AccountProvider
              accounts={accounts}
              initialSelectedAccountId={initialSelectedAccountId}
            >
              <div className="flex min-h-screen">
                {/* Backdrop for the mobile drawer */}
                {mobileNavOpen ? (
                  <div
                    className="fixed inset-0 z-30 bg-black/50 animate-fade-in lg:hidden"
                    onClick={() => setMobileNavOpen(false)}
                    aria-hidden="true"
                  />
                ) : null}

                <aside
                  className={cn(
                    "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col gap-5 border-r border-border bg-surface p-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
                    mobileNavOpen ? "translate-x-0" : "-translate-x-full",
                  )}
                >
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-2.5 px-1"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                      S
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        SNS分析・投稿支援
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        X / Threads 運用ツール
                      </span>
                    </span>
                  </Link>

                  <AccountSwitcher />

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SideNav onNavigate={() => setMobileNavOpen(false)} />
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <span className="px-1 text-xs text-muted-foreground">
                      表示テーマ
                    </span>
                    <ThemeToggle />
                  </div>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col">
                  <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setMobileNavOpen(true)}
                      aria-label="メニューを開く"
                    >
                      <MenuIcon className="h-5 w-5" />
                    </Button>
                    <span className="text-sm font-semibold">
                      SNS分析・投稿支援
                    </span>
                  </header>

                  <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
                    {children}
                  </main>
                </div>
              </div>
            </AccountProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </body>
  );
}
