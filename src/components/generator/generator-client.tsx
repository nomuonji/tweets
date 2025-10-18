"use client";

import { useMemo, useState } from "react";
import type { AccountDoc, DraftDoc, PostDoc } from "@/lib/types";

type SlotOption = {
  key: string;
  label: string;
  iso: string;
  reservedBy?: string;
};

type GeneratorClientProps = {
  candidates: PostDoc[];
  drafts: DraftDoc[];
  accounts: AccountDoc[];
  slotOptions: {
    x: SlotOption[];
    threads: SlotOption[];
  };
};

type LocalDraft = DraftDoc & {
  localText: string;
  localHashtags: string[];
  selectedSlot?: string;
  selectedAccount?: string;
  statusMessage?: string;
};

function formatHashtags(hashtags: string[]) {
  return hashtags.join(" ");
}

function parseHashtags(value: string) {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag));
}

export function GeneratorClient({
  candidates,
  drafts,
  accounts,
  slotOptions,
}: GeneratorClientProps) {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(
    candidates[0]?.id ?? null,
  );
  const [generated, setGenerated] = useState<LocalDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const selectedPost = useMemo(
    () => candidates.find((item) => item.id === selectedPostId),
    [candidates, selectedPostId],
  );

  const defaultAccountId = useMemo(() => {
    if (!selectedPost) {
      return accounts[0]?.id;
    }
    return (
      accounts.find(
        (account) => account.platform === selectedPost.platform,
      )?.id ?? accounts[0]?.id
    );
  }, [accounts, selectedPost]);

  const handleGenerate = async () => {
    if (!selectedPost) {
      return;
    }
    setLoading(true);
    setGenerated([]);
    setActionMessage(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basePostId: selectedPost.id,
          platform: selectedPost.platform,
          createdBy: "manual",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "Failed to generate drafts");
      }

      const newDrafts: LocalDraft[] = data.drafts.map((draft: DraftDoc) => {
        const slotList = slotOptions[draft.target_platform];
        const platformAccounts = accounts.filter(
          (account) => account.platform === draft.target_platform,
        );
        return {
          ...draft,
          localText: draft.text,
          localHashtags: draft.hashtags,
          selectedAccount: accountIdFallback(platformAccounts, defaultAccountId),
          selectedSlot: slotList[0]?.key,
        };
      });
      setGenerated(newDrafts);
      setActionMessage("Generated three draft ideas.");
    } catch (error) {
      setActionMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSchedule = async (draft: LocalDraft) => {
    const slotKey = draft.selectedSlot;
    const accountId = draft.selectedAccount;
    if (!slotKey) {
      setActionMessage("Select a slot before scheduling.");
      return;
    }
    if (!accountId) {
      setActionMessage("Select an account before scheduling.");
      return;
    }
    try {
      setActionMessage(null);
      await fetch(`/api/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: draft.localText,
          hashtags: draft.localHashtags,
        }),
      });

      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          slotKey,
          platform: draft.target_platform,
          accountId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "Failed to schedule draft");
      }

      setActionMessage("Draft scheduled successfully.");
      setGenerated((prev) =>
        prev.map((item) =>
          item.id === draft.id
            ? {
                ...item,
                status: "scheduled",
                statusMessage: "Draft scheduled successfully.",
              }
            : item,
        ),
      );
    } catch (error) {
      setActionMessage((error as Error).message);
    }
  };

  const handleTextChange = (id: string, text: string) => {
    setGenerated((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, localText: text } : item,
      ),
    );
  };

  const handleHashtagChange = (id: string, input: string) => {
    setGenerated((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, localHashtags: parseHashtags(input) }
          : item,
      ),
    );
  };

  const handleSlotChange = (id: string, slotKey: string) => {
    setGenerated((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selectedSlot: slotKey } : item,
      ),
    );
  };

  const handleAccountChange = (id: string, accountId: string) => {
    setGenerated((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selectedAccount: accountId } : item,
      ),
    );
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Generator & Scheduler</h1>
        <p className="text-sm text-muted-foreground">
          Select a high performing post, generate variations, and schedule across platforms.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Base posts
          </h2>
          <div className="space-y-3">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setSelectedPostId(candidate.id)}
                className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${
                  candidate.id === selectedPostId
                    ? "border-primary bg-surface-active text-primary"
                    : "border-border hover:border-primary"
                }`}
              >
                <p className="line-clamp-3">{candidate.text}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{candidate.platform.toUpperCase()}</span>
                  <span>Score {candidate.score.toFixed(3)}</span>
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedPost || loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Generating..." : "Generate 3 options"}
          </button>
          {actionMessage && (
            <p className="text-xs text-muted-foreground">{actionMessage}</p>
          )}
        </aside>

        <section className="space-y-6">
          {generated.length > 0 ? (
            generated.map((draft) => {
              const slotList = slotOptions[draft.target_platform];
              const platformAccounts = accounts.filter(
                (account) => account.platform === draft.target_platform,
              );

              return (
                <div
                  key={draft.id}
                  className="space-y-4 rounded-xl border border-border bg-surface p-6"
                >
                  <header className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">
                        {draft.target_platform.toUpperCase()} Draft
                      </p>
                      {draft.similarity_warning && (
                        <p className="text-xs text-red-600">
                          Similar to the source post (&gt;= 0.8). Consider editing.
                        </p>
                      )}
                    </div>
                  </header>

                  <textarea
                    value={draft.localText}
                    onChange={(event) =>
                      handleTextChange(draft.id, event.target.value)
                    }
                    className="h-32 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  />

                  <div className="flex flex-wrap gap-4">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">Hashtags</span>
                      <input
                        value={formatHashtags(draft.localHashtags)}
                        onChange={(event) =>
                          handleHashtagChange(draft.id, event.target.value)
                        }
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="#keyword"
                      />
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">Account</span>
                      <select
                        value={draft.selectedAccount ?? ""}
                        onChange={(event) =>
                          handleAccountChange(draft.id, event.target.value)
                        }
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        {!draft.selectedAccount && (
                          <option value="" disabled>
                            Select account
                          </option>
                        )}
                        {platformAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            @{account.handle}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">Slot</span>
                      <select
                        value={draft.selectedSlot ?? ""}
                        onChange={(event) =>
                          handleSlotChange(draft.id, event.target.value)
                        }
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        {!draft.selectedSlot && (
                          <option value="" disabled>
                            Select slot
                          </option>
                        )}
                        {slotList.map((slot) => (
                          <option
                            key={slot.key}
                            value={slot.key}
                            disabled={Boolean(slot.reservedBy)}
                          >
                            {slot.label}
                            {slot.reservedBy ? " (reserved)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSchedule(draft)}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Schedule draft
                  </button>
                  {draft.statusMessage && (
                    <p className="text-xs text-muted-foreground">
                      {draft.statusMessage}
                    </p>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/40 p-6 text-sm text-muted-foreground">
              Select a base post on the left and generate ideas to start scheduling.
            </div>
          )}

          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">
              Existing drafts
            </h2>
            <div className="space-y-3">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="rounded-lg border border-border bg-surface p-4 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase text-muted-foreground">
                      {draft.target_platform.toUpperCase()} - {draft.status}
                    </p>
                    {draft.schedule_time && (
                      <p className="text-xs text-muted-foreground">
                        Scheduled: {draft.schedule_time}
                      </p>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-3 text-muted-foreground">
                    {draft.text}
                  </p>
                </div>
              ))}
              {drafts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No drafts yet.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function accountIdFallback(
  accounts: AccountDoc[],
  defaultId: string | undefined,
) {
  if (defaultId && accounts.some((account) => account.id === defaultId)) {
    return defaultId;
  }
  return accounts[0]?.id;
}
