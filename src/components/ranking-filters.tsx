"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { AccountDoc } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/field";

type RankingFiltersProps = {
  platform: string;
  media: string;
  period: string;
  sort: string;
  accountId: string;
  accounts: AccountDoc[];
};

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9"
      >
        {children}
      </Select>
    </label>
  );
}

export function RankingFilters({
  platform,
  media,
  period,
  sort,
  accountId,
  accounts,
}: RankingFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();

  const updateParam = (key: string, value: string) => {
    const search = new URLSearchParams(params.toString());
    search.set(key, value);
    search.delete("page");
    router.replace(`/ranking?${search.toString()}`);
  };

  return (
    <Card>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect
          label="アカウント"
          value={accountId}
          onChange={(value) => updateParam("accountId", value)}
        >
          <option value="all">すべて</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.display_name || `@${account.handle}`}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label="プラットフォーム"
          value={platform}
          onChange={(value) => updateParam("platform", value)}
        >
          <option value="all">すべて</option>
          <option value="x">X</option>
          <option value="threads">Threads</option>
        </FilterSelect>

        <FilterSelect
          label="メディア種別"
          value={media}
          onChange={(value) => updateParam("media", value)}
        >
          <option value="all">すべて</option>
          <option value="text">テキスト</option>
          <option value="image">画像</option>
          <option value="video">動画</option>
        </FilterSelect>

        <FilterSelect
          label="期間"
          value={period}
          onChange={(value) => updateParam("period", value)}
        >
          <option value="all">全期間</option>
          <option value="7">過去7日</option>
          <option value="30">過去30日</option>
          <option value="90">過去90日</option>
        </FilterSelect>

        <FilterSelect
          label="並び順"
          value={sort}
          onChange={(value) => updateParam("sort", value)}
        >
          <option value="top">スコアが高い順</option>
          <option value="latest">新しい順</option>
        </FilterSelect>
      </CardContent>
    </Card>
  );
}
