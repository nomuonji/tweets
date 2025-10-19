"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccountContext } from "@/components/account/account-provider";

type AccountOption = {
  id: string;
  handle: string;
  displayName: string;
  platform: "x" | "threads";
};

type SuggestionResult = {
  tweet: string;
  explanation: string;
};

type ContextPost = {
  id: string;
  text: string;
  score: number;
  impressions: number;
  likes: number;
  reposts: number;
  replies: number;
  source: "top" | "recent";
};

type ExistingDraftSummary = {
  id: string;
  text: string;
  updatedAt?: string;
};

type SmartTweetGeneratorProps = {
  accounts: AccountOption[];
};

export function SmartTweetGenerator({ accounts }: SmartTweetGeneratorProps) {
  const { selectedAccountId, setSelectedAccountId } = useAccountContext();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [postLimit, setPostLimit] = useState(15);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [contextPosts, setContextPosts] = useState<ContextPost[]>([]);
  const [existingDrafts, setExistingDrafts] = useState<ExistingDraftSummary[]>(
    [],
  );
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }
    if (selectedAccountId !== accountId) {
      setAccountId(selectedAccountId);
    }
  }, [selectedAccountId, accountId]);

  useEffect(() => {
    if (!selectedAccountId && accountId) {
      setSelectedAccountId(accountId);
    }
  }, [accountId, selectedAccountId, setSelectedAccountId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId),
    [accounts, accountId],
  );

  const handleGenerate = async () => {
    if (!accountId) {
      setError("Please select an account.");
      return;
    }

    setLoading(true);
    setError(null);
    setSaveMessage(null);
    setSuggestion(null);
    setDuplicateWarning(false);
    setContextPosts([]);
    setExistingDrafts([]);
    try {
      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          limit: postLimit,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Failed to generate a suggestion.");
      }

      setSuggestion(data.suggestion as SuggestionResult);
      setContextPosts((data.context?.usedPosts ?? []) as ContextPost[]);
      setExistingDrafts((data.context?.existingDrafts ?? []) as ExistingDraftSummary[]);
      setDuplicateWarning(Boolean(data.duplicate));
    } catch (generateError) {
      setError((generateError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!suggestion || !selectedAccount) {
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccount.id,
          platform: selectedAccount.platform,
          text: suggestion.tweet,
          createdBy: "gemini",
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Failed to save the draft.");
      }

      setSaveMessage("Saved to drafts.");
      if (data.draft) {
        setExistingDrafts((prev) => [
          {
            id: data.draft.id as string,
            text: data.draft.text as string,
            updatedAt: data.draft.updated_at as string | undefined,
          },
          ...prev,
        ]);
      }
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Gemini Idea Generator</h2>
          <p className="text-sm text-muted-foreground">
            Analyze past engagement and let Gemini suggest a new post with a short rationale.
          </p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              setSelectedAccountId(event.target.value);
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm md:w-auto"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                @{account.handle}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label
              htmlFor="post-limit"
              className="text-xs text-muted-foreground"
            >
              Reference posts
            </label>
            <input
              id="post-limit"
              type="number"
              value={postLimit}
              onChange={(e) => setPostLimit(Number(e.target.value))}
              min="6"
              max="40"
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </div>
          <span className="text-xs text-muted-foreground md:w-40">
            Uses top performers and latest posts (roughly half each).
          </span>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || accounts.length === 0}
            className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Generating..." : "Generate suggestion"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {suggestion && (
        <div className="space-y-4 rounded-lg border border-border bg-background p-4">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Suggested post
            </p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">
              {suggestion.tweet}
            </p>
          </div>
          <div className="border-t border-dashed border-border pt-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Why it should work
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {suggestion.explanation}
            </p>
          </div>
          <div className="flex flex-col gap-2 border-t border-dashed border-border pt-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
              >
                {saving ? "Saving..." : "Save as draft"}
              </button>
              {saveMessage && (
                <span className="text-xs text-emerald-600 md:text-sm">{saveMessage}</span>
              )}
            </div>
            {duplicateWarning && (
              <p className="text-xs text-amber-600">
                This content is very similar to an existing draft. Consider tweaking the text or regenerating.
              </p>
            )}
          </div>
        </div>
      )}

      {contextPosts.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Reference posts used
          </p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {contextPosts.map((post) => {
              const sourceLabel = post.source === "top" ? "Top performer" : "Latest post";
              const scoreValue =
                typeof post.score === "number" && Number.isFinite(post.score)
                  ? post.score
                  : 0;
              const impressionsValue =
                typeof post.impressions === "number" && Number.isFinite(post.impressions)
                  ? post.impressions
                  : 0;
              const likesValue =
                typeof post.likes === "number" && Number.isFinite(post.likes)
                  ? post.likes
                  : 0;
              const repostsValue =
                typeof post.reposts === "number" && Number.isFinite(post.reposts)
                  ? post.reposts
                  : 0;
              const repliesValue =
                typeof post.replies === "number" && Number.isFinite(post.replies)
                  ? post.replies
                  : 0;
              return (
                <li
                  key={post.id}
                  className="rounded-md border border-border/50 bg-surface px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide">
                    <span className="rounded-full border border-border px-2 py-[2px] text-[10px] font-semibold">
                      {sourceLabel}
                    </span>
                    <span>Score {scoreValue.toFixed(3)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2">{post.text}</p>
                  <div className="mt-1 flex flex-wrap gap-3 text-[10px] uppercase tracking-wide">
                    <span>Impr {impressionsValue}</span>
                    <span>Likes {likesValue}</span>
                    <span>Reposts {repostsValue}</span>
                    <span>Replies {repliesValue}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {existingDrafts.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Recent drafts (for duplicate checks)
          </p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {existingDrafts.slice(0, 5).map((draft) => (
              <li
                key={draft.id}
                className="rounded-md border border-border/50 bg-surface px-3 py-2"
              >
                <p className="line-clamp-2">{draft.text}</p>
                {draft.updatedAt && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Updated {draft.updatedAt}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
