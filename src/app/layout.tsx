import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { getAccounts } from "@/lib/services/firestore.server";
import type { AccountDoc } from "@/lib/types";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "SNS分析・投稿支援",
  description:
    "X / Threads アカウントの統合分析、生成支援、予約投稿を提供する内部ツール。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const storedAccountId = cookieStore.get("selected-account-id")?.value ?? null;

  let accounts: AccountDoc[] = [];
  let quotaWarning = false;
  try {
    accounts = await getAccounts();
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = (error as Error).message ?? "";
    const isQuota =
      code === "firestore/quota-exceeded" ||
      (typeof code === "string" && code.toLowerCase().includes("resource")) ||
      message.includes("quota");
    if (isQuota) {
      quotaWarning = true;
    } else {
      throw error;
    }
  }

  const initialSelectedAccountId =
    storedAccountId && accounts.some((account) => account.id === storedAccountId)
      ? storedAccountId
      : accounts[0]?.id ?? null;

  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable}`}>
      <AppShell accounts={accounts} initialSelectedAccountId={initialSelectedAccountId}>
        {quotaWarning ? (
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Firestore quota was exceeded while loading accounts. Account data may be limited until the quota resets.
          </p>
        ) : null}
        {children}
      </AppShell>
    </html>
  );
}
