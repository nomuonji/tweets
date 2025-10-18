"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "ダッシュボード" },
  { href: "/ranking", label: "ランキング" },
  { href: "/generator", label: "生成・予約" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-3 text-sm font-medium">
      {navItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 transition hover:bg-surface-hover",
              isActive
                ? "bg-surface-active text-primary"
                : "text-muted-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
