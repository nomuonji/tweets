'use client';

import { useEffect, useMemo, useState } from "react";
import { useAccountContext } from "@/components/account/account-provider";

// ... (type definitions are unchanged)
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
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [contextPosts, setContextPosts] = useState<ContextPost[]>([]);
  const [existingDrafts, setExistingDrafts] = useState<ExistingDraftSummary[]>([]);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  // ... (useEffect and useMemo hooks are unchanged)
  useEffect(() => {
    if (!selectedAccountId) return;
    if (selectedAccountId !== accountId) setAccountId(selectedAccountId);
  }, [selectedAccountId, accountId]);

  useEffect(() => {
    if (!selectedAccountId && accountId) setSelectedAccountId(accountId);
  }, [accountId, selectedAccountId, setSelectedAccountId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId),
    [accounts, accountId],
  );

  const handlePreviewPrompt = async () => {
    if (!accountId) {
      setError("Please select an account.");
      return;
    }
    setPreviewLoading(true);
    setError(null);
    setLastPrompt(null);
    try {
      const response = await fetch("/api/gemini/prepare-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, limit: postLimit }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Failed to prepare prompt.");
      }
      setLastPrompt(data.prompt as string);
    } catch (previewError) {
      setError((previewError as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

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
    setLastPrompt(null);
    try {
      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, limit: postLimit }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Failed to generate a suggestion.");
      }
      setSuggestion(data.suggestion as SuggestionResult);
      setContextPosts((data.context?.usedPosts ?? []) as ContextPost[]);
      setExistingDrafts((data.context?.existingDrafts ?? []) as ExistingDraftSummary[]);
      setDuplicateWarning(Boolean(data.duplicate));
      if (data.prompt) {
        setLastPrompt(data.prompt as string);
      }
    } catch (generateError) {
      setError((generateError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // ... (handleSave function is unchanged)
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Gemini Idea Generator</h2>
          <p className="text-sm text-muted-foreground">Analyze past engagement and let Gemini suggest a new post.</p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setSelectedAccountId(e.target.value); }} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm md:w-auto">
            {accounts.map((account) => <option key={account.id} value={account.id}>@{account.handle}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label htmlFor="post-limit" className="text-xs text-muted-foreground">Reference posts</label>
            <input id="post-limit" type="number" value={postLimit} onChange={(e) => setPostLimit(Number(e.target.value))} min="6" max="40" className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm" />
          </div>
          <button type="button" onClick={handleGenerate} disabled={loading || previewLoading || accounts.length === 0} className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? "Generating..." : "Generate suggestion"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      <details className="rounded-lg border border-border bg-background p-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Prompt Preview</summary>
        <div className="mt-4 space-y-3">
            <button type="button" onClick={handlePreviewPrompt} disabled={previewLoading || loading} className="rounded-md border border-border bg-background px-3 py-1 text-sm font-medium text-secondary-foreground transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60">
                {previewLoading ? "Building..." : "Build/Refresh Prompt"}
            </button>
            {lastPrompt ? (
                <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground/80 p-3 bg-surface rounded-md">{lastPrompt}</pre>
            ) : (
                <p className="text-xs text-muted-foreground italic mt-2">Click the button to build the prompt that will be sent to Gemini.</p>
            )}
        </div>
      </details>

      {suggestion && (
        <div className="space-y-4 rounded-lg border border-green-500/50 bg-green-500/5 p-4">
          <div>
            <p className="text-xs font-medium uppercase text-green-600">Suggested post</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{suggestion.tweet}</p>
          </div>
          <div className="border-t border-dashed border-border pt-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Why it should work</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{suggestion.explanation}</p>
          </div>
          <div className="flex flex-col gap-2 border-t border-dashed border-border pt-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <button type="button" onClick={handleSave} disabled={saving} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold ...">
                {saving ? "Saving..." : "Save as draft"}
              </button>
              {saveMessage && <span className="text-xs text-emerald-600 md:text-sm">{saveMessage}</span>}
            </div>
            {duplicateWarning && <p className="text-xs text-amber-600">This content is very similar to an existing draft.</p>}
          </div>
        </div>
      )}

      {contextPosts.length > 0 && <div className="space-y-2 rounded-lg border ...">...</div>}
      {existingDrafts.length > 0 && <div className="space-y-2 rounded-lg border ...">...</div>}
    </div>
  );
}
