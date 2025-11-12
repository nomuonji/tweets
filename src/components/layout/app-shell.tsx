import type { AccountDoc } from "@/lib/types";
import { AccountProvider } from "@/components/account/account-provider";
import { AccountSwitcher } from "@/components/account/account-switcher";
import { TopNav } from "./top-nav";

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
  return (
    <body className="min-h-screen bg-background text-foreground">
      <AccountProvider
        accounts={accounts}
        initialSelectedAccountId={initialSelectedAccountId}
      >
        <div className="min-h-screen">
          <header className="border-b border-border bg-surface px-6 py-4">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-lg font-semibold">SNS刁E��・投稿支援</p>
                <p className="text-sm text-muted-foreground">
                  X / Threads アカウント�E統合�E析と運用支援
                </p>
              </div>
              <div className="flex shrink flex-col items-end gap-3 md:flex-row md:items-center md:gap-4">
                <TopNav />
                <AccountSwitcher />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </div>
      </AccountProvider>
    </body>
  );
}
