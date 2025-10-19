import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { getAccounts } from "@/lib/services/firestore.server";

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
  const accounts = await getAccounts();

  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable}`}>
      <AppShell accounts={accounts}>{children}</AppShell>
    </html>
  );
}
