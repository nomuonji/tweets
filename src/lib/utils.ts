import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { AccountDoc } from "@/lib/types";

/**
 * Merge class names, resolving Tailwind conflicts so that classes passed by a
 * caller reliably override a component's defaults (a plain string join does
 * not — CSS resolves conflicts by stylesheet order, not attribute order).
 */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

export function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const PLATFORM_LABELS: Record<string, string> = {
  x: "X",
  threads: "Threads",
};

/** Human-facing platform name (`x` renders as `X`, not `X` via title-casing). */
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? toTitleCase(platform);
}

/** Keep enabled accounts easy to find anywhere accounts are presented. */
export function sortAccountsByAutoPost<T extends Pick<AccountDoc, "autoPostEnabled" | "handle">>(
  accounts: T[],
): T[] {
  return [...accounts].sort((a, b) => {
    const enabledOrder = Number(b.autoPostEnabled === true) - Number(a.autoPostEnabled === true);
    return enabledOrder || a.handle.localeCompare(b.handle);
  });
}
