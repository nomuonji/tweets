"use client";

import { useRouter, useSearchParams } from "next/navigation";

type RankingFiltersProps = {
  platform: string;
  media: string;
  period: string;
  sort: string;
};

export function RankingFilters({
  platform,
  media,
  period,
  sort,
}: RankingFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();

  const updateParam = (key: string, value: string) => {
    const search = new URLSearchParams(params);
    search.set(key, value);
    router.replace(`/ranking?${search.toString()}`);
  };

  return (
    <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface p-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Platform</span>
        <select
          value={platform}
          onChange={(event) => updateParam("platform", event.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="x">X</option>
          <option value="threads">Threads</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Media</span>
        <select
          value={media}
          onChange={(event) => updateParam("media", event.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Period</span>
        <select
          value={period}
          onChange={(event) => updateParam("period", event.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Sort</span>
        <select
          value={sort}
          onChange={(event) => updateParam("sort", event.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="top">Popular</option>
          <option value="latest">Latest</option>
        </select>
      </label>
    </div>
  );
}
