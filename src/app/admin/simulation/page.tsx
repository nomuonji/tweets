"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountDoc } from "@/lib/types";
import type { SimulateRequestBody } from "@/app/api/gemini/simulate/route";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { AlertIcon } from "@/components/ui/icons";
import { cn, sortAccountsByAutoPost } from "@/lib/utils";

type AccountDetails = Omit<SimulateRequestBody, "prompt">;

const EMPTY_DETAILS: AccountDetails = {
  concept: "",
  topPosts: [],
  referencePosts: [],
  recentPosts: [],
  drafts: [],
  tips: [],
  exemplaryPosts: [],
};

const JSON_FIELDS: Array<{ label: string; field: keyof AccountDetails }> = [
  { label: "高スコアの投稿", field: "topPosts" },
  { label: "最近の投稿", field: "recentPosts" },
  { label: "参考投稿", field: "referencePosts" },
  { label: "重複を避ける下書き", field: "drafts" },
  { label: "Tips", field: "tips" },
  { label: "お手本投稿", field: "exemplaryPosts" },
];

export default function SimulationPage() {
  const [accounts, setAccounts] = useState<AccountDoc[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);

  const [promptData, setPromptData] = useState<AccountDetails>(EMPTY_DETAILS);
  const [editablePrompt, setEditablePrompt] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<{
    tweet: string;
    explanation: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<Record<string, string | null>>({});

  // Local text buffers so a half-typed JSON edit isn't reformatted mid-keystroke.
  const [jsonText, setJsonText] = useState<Record<string, string>>({});

  const syncJsonText = useCallback((details: AccountDetails) => {
    const next: Record<string, string> = {};
    JSON_FIELDS.forEach(({ field }) => {
      next[field] = JSON.stringify(details[field] ?? [], null, 2);
    });
    setJsonText(next);
    setJsonError({});
  }, []);

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch("/api/accounts");
        const data = await res.json();
        if (data.ok) setAccounts(sortAccountsByAutoPost(data.accounts));
        else setError(data.message);
      } catch {
        setError("アカウントを取得できませんでした。");
      }
    };
    fetchAccounts();
    syncJsonText(EMPTY_DETAILS);
  }, [syncJsonText]);

  useEffect(() => {
    if (!selectedAccountId) {
      setPromptData(EMPTY_DETAILS);
      syncJsonText(EMPTY_DETAILS);
      return;
    }

    const fetchAccountDetails = async () => {
      setIsDetailsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/accounts?accountId=${selectedAccountId}`);
        const data = await res.json();
        if (!data.ok) {
          setError(data.message);
          return;
        }
        const details = data.accountDetails;
        const next: AccountDetails = {
          concept: details.account.concept ?? "",
          topPosts: details.topPosts,
          referencePosts: details.referencePosts,
          recentPosts: details.recentPosts,
          drafts: details.drafts,
          tips: details.tips,
          exemplaryPosts: details.exemplaryPosts,
        };
        setPromptData(next);
        syncJsonText(next);
      } catch {
        setError("アカウント情報を取得できませんでした。");
      } finally {
        setIsDetailsLoading(false);
      }
    };
    fetchAccountDetails();
  }, [selectedAccountId, syncJsonText]);

  // Rebuild the prompt preview whenever the inputs settle into a valid state.
  useEffect(() => {
    const preparePrompt = async () => {
      if (Object.values(jsonError).some(Boolean)) return;
      if (!promptData.concept && promptData.recentPosts?.length === 0) {
        setEditablePrompt("");
        return;
      }

      setIsPromptLoading(true);
      try {
        const res = await fetch("/api/gemini/prepare-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(promptData),
        });
        const data = await res.json();
        if (data.ok) setEditablePrompt(data.prompt);
      } catch {
        // Preview is best-effort; the editable box stays usable either way.
      } finally {
        setIsPromptLoading(false);
      }
    };

    preparePrompt();
  }, [promptData, jsonError]);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setGeneratedResult(null);

    try {
      const body: SimulateRequestBody = { ...promptData };
      if (editablePrompt.trim()) body.prompt = editablePrompt;

      const res = await fetch("/api/gemini/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.ok) {
        setGeneratedResult(data.suggestion);
        setEditablePrompt(data.prompt);
      } else {
        setError(data.message);
      }
    } catch {
      setError("投稿の生成に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJsonChange = (field: keyof AccountDetails, value: string) => {
    setJsonText((prev) => ({ ...prev, [field]: value }));
    try {
      const parsed = JSON.parse(value);
      setPromptData((prev) => ({ ...prev, [field]: parsed }));
      setJsonError((prev) => ({ ...prev, [field]: null }));
    } catch {
      setJsonError((prev) => ({ ...prev, [field]: "JSON の形式が不正です。" }));
    }
  };

  const hasJsonError = Object.values(jsonError).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="プロンプト検証"
        description="入力データとプロンプトを直接編集し、生成結果を試せます。ここでの生成は下書きとして保存されません。"
      />

      {error ? (
        <EmptyState
          tone="error"
          icon={<AlertIcon className="h-5 w-5" />}
          title="エラーが発生しました"
          description={error}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>入力データ</CardTitle>
            <CardDescription>
              アカウントを選ぶと実データが読み込まれます。各項目は直接編集できます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="アカウント（任意）">
              {(id) => (
                <Select
                  id={id}
                  value={selectedAccountId}
                  disabled={isDetailsLoading}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                >
                  <option value="">選択しない（空の状態から作る）</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      @{account.handle} · 自動投稿 {account.autoPostEnabled ? "ON" : "OFF"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="コンセプト">
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  value={promptData.concept}
                  disabled={isDetailsLoading}
                  onChange={(event) =>
                    setPromptData((prev) => ({
                      ...prev,
                      concept: event.target.value,
                    }))
                  }
                />
              )}
            </Field>

            {JSON_FIELDS.map(({ label, field }) => (
              <Field
                key={field}
                label={`${label}（JSON）`}
                error={jsonError[field]}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    value={jsonText[field] ?? "[]"}
                    disabled={isDetailsLoading}
                    onChange={(event) =>
                      handleJsonChange(field, event.target.value)
                    }
                    className={cn(
                      "h-40 font-mono text-xs",
                      jsonError[field] && "border-destructive",
                    )}
                  />
                )}
              </Field>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>最終プロンプト</CardTitle>
              <CardDescription>
                空にすると入力データから自動生成されます。直接編集や貼り付けも可能です。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={editablePrompt}
                onChange={(event) => setEditablePrompt(event.target.value)}
                placeholder={
                  isPromptLoading
                    ? "プロンプトを生成中..."
                    : "ここにプロンプトが表示されます"
                }
                disabled={isPromptLoading}
                className="h-96 font-mono text-xs"
              />
              <Button
                className="w-full"
                loading={isLoading}
                disabled={isDetailsLoading || hasJsonError}
                onClick={handleGenerate}
              >
                {isLoading ? "生成中..." : "この内容で生成する"}
              </Button>
              {hasJsonError ? (
                <p className="text-xs text-destructive">
                  JSON にエラーがあるため生成できません。
                </p>
              ) : null}
            </CardContent>
          </Card>

          {generatedResult ? (
            <Card>
              <CardHeader>
                <CardTitle>生成結果</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    投稿案
                  </p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-relaxed">
                    {generatedResult.tweet}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    解説
                  </p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-relaxed text-muted-foreground">
                    {generatedResult.explanation}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
