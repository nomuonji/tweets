"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  DashboardIcon,
  InboxIcon,
  TrophyIcon,
  UsersIcon,
} from "@/components/ui/icons";

export const navItems = [
  { href: "/dashboard", label: "ダッシュボード", Icon: DashboardIcon },
  { href: "/analytics", label: "分析", Icon: TrophyIcon },
  { href: "/products", label: "商品カタログ", Icon: InboxIcon },
  { href: "/accounts", label: "アカウント", Icon: UsersIcon },
];

export function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="メインナビゲーション">
      {navItems.map(({ href, label, Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
