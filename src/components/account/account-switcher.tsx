"use client";

import { useMemo } from "react";
import { useAccountContext } from "./account-provider";
import { toTitleCase } from "@/lib/utils";

export function AccountSwitcher() {
  const { accounts, selectedAccountId, setSelectedAccountId, selectedAccount } =
    useAccountContext();

  const options = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `@${account.handle}${
          account.display_name ? ` / ${account.display_name}` : ""
        }`,
        platform: toTitleCase(account.platform),
      })),
    [accounts],
  );

  if (accounts.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-nowrap text-xs uppercase tracking-wide text-muted-foreground">
        運用アカウント
      </span>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
        <span className="hidden text-xs text-muted-foreground md:inline-block">
          {selectedAccount
            ? toTitleCase(selectedAccount.platform)
            : "未選択"}
        </span>
        <select
          value={selectedAccountId ?? ""}
          onChange={(event) => setSelectedAccountId(event.target.value)}
          className="min-w-0 flex-1 basis-auto bg-transparent text-sm outline-none"
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              className="truncate"
            >
              {option.platform} · {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
