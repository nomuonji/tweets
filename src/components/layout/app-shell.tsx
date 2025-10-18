import { TopNav } from "./top-nav";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <body className="min-h-screen bg-background text-foreground">
      <div className="min-h-screen">
        <header className="border-b border-border bg-surface px-6 py-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-lg font-semibold">SNS分析・投稿支援</p>
              <p className="text-sm text-muted-foreground">
                X / Threads アカウントの統合分析と生成・予約管理
              </p>
            </div>
            <TopNav />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>
    </body>
  );
}
