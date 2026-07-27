"use client";

import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";

/**
 * Cycles light → dark → follow-OS. The title spells out the current state so
 * the "system" step is discoverable from a single control.
 */
export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();

  const next =
    preference === "light" ? "dark" : preference === "dark" ? "system" : "light";

  const label =
    preference === "system"
      ? `テーマ: OS設定に追従（現在は${resolved === "dark" ? "ダーク" : "ライト"}）`
      : preference === "dark"
        ? "テーマ: ダーク"
        : "テーマ: ライト";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setPreference(next)}
      title={`${label} / クリックで切り替え`}
      aria-label={label}
      className="relative"
    >
      {resolved === "dark" ? (
        <MoonIcon className="h-[18px] w-[18px]" />
      ) : (
        <SunIcon className="h-[18px] w-[18px]" />
      )}
      {preference === "system" ? (
        <span
          className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : null}
    </Button>
  );
}
