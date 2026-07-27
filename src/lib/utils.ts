import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
