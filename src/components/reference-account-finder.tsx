"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card } from "@/components/ui/card";

type Candidate = {
  handle: string;
  postCount: number;
  topPost: string;
  score: number;
};

export function ReferenceAccountFinder({
  onAdd,
}: {
  onAdd: (handle: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const search = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/reference-accounts/candidates?keyword=${encodeURIComponent(keyword.trim())}`,
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message ?? "候補を取得できませんでした。");
      setCandidates(data.candidates ?? []);
      setMessage(data.candidates?.length ? null : "候補が見つかりませんでした。");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <p className="text-xs font-medium">参考アカウントを探す</p>
      <div className="flex gap-2">
        <Input
          value={keyword}
          placeholder="テーマやキーワード"
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") search();
          }}
        />
        <Button size="sm" variant="outline" loading={loading} onClick={search}>
          探す
        </Button>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {candidates.length > 0 ? (
        <div className="space-y-2">
          {candidates.slice(0, 5).map((candidate) => (
            <Card key={candidate.handle} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">@{candidate.handle}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {candidate.topPost}
                  </p>
                </div>
                <Button size="sm" onClick={() => onAdd(candidate.handle)}>
                  追加
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
