"use client";

import Link from "next/link";

export function AddAccountButton() {
  return (
    <Link
      href="/accounts/connect"
      className="rounded-md border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
    >
      アカウントを追加
    </Link>
  );
}
