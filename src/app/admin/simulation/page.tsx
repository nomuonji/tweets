"use client";

import { useState, useEffect } from "react";
import type { AccountDoc } from "@/lib/types";
import type { SimulateRequestBody } from "@/app/api/gemini/simulate/route";

type AccountDetails = Omit<SimulateRequestBody, "prompt">;

export default function SimulationPage() {
  const [accounts, setAccounts] = useState<AccountDoc[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDetailsLoading, setIsDetailsLoading] = useState<boolean>(false);

  const [promptData, setPromptData] = useState<AccountDetails>({
    concept: "",
    topPosts: [],
    referencePosts: [],
    recentPosts: [],
    drafts: [],
    tips: [],
    exemplaryPosts: [],
  });
  const [editablePrompt, setEditablePrompt] = useState<string>("");
  const [isPromptLoading, setIsPromptLoading] = useState<boolean>(false);
  const [generatedResult, setGeneratedResult] = useState<{ tweet: string, explanation: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch("/api/accounts");
        const data = await res.json();
        if (data.ok) {
          setAccounts(data.accounts);
        } else {
          setError(data.message);
        }
      } catch {
        setError("Failed to fetch accounts.");
      }
    };
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (!selectedAccountId) {
      setPromptData({
        concept: "", topPosts: [], referencePosts: [], recentPosts: [], drafts: [], tips: [], exemplaryPosts: [],
      });
      return;
    };

    const fetchAccountDetails = async () => {
      setIsDetailsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/accounts?accountId=${selectedAccountId}`);
        const data = await res.json();
        if (data.ok) {
          const details = data.accountDetails;
          setPromptData({
            concept: details.account.concept,
            topPosts: details.topPosts,
            referencePosts: details.referencePosts,
            recentPosts: details.recentPosts,
            drafts: details.drafts,
            tips: details.tips,
            exemplaryPosts: details.exemplaryPosts,
          });
        } else {
          setError(data.message);
        }
      } catch {
        setError("Failed to fetch account details.");
      } finally {
        setIsDetailsLoading(false);
      }
    };
    fetchAccountDetails();
  }, [selectedAccountId]);

  // Fetch prompt when data changes
  useEffect(() => {
    const preparePrompt = async () => {
      // Do not generate if any JSON is currently invalid
      if (Object.values(jsonError).some(Boolean)) return;

      // Do not generate if there is no concept and no recent posts
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
        if (data.ok) {
          setEditablePrompt(data.prompt);
        }
      } catch {
        // Do not set a global error, just fail silently
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
      if (editablePrompt.trim()) {
        body.prompt = editablePrompt;
      }

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
      setError("Failed to generate post.");
    } finally {
      setIsLoading(false);
    }
  };

  const formatJson = (data: unknown) => JSON.stringify(data, null, 2);

  const handleJsonChange = (field: keyof AccountDetails, value: string) => {
    try {
      const parsed = JSON.parse(value);
      setPromptData(prev => ({ ...prev, [field]: parsed }));
      setJsonError(prev => ({ ...prev, [field]: null }));
    } catch {
      setJsonError(prev => ({ ...prev, [field]: "Invalid JSON format." }));
    }
  };

  const renderJsonTextarea = (label: string, field: keyof AccountDetails) => (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label} (JSON)</label>
      <textarea
        value={formatJson(promptData[field])}
        onChange={(e) => handleJsonChange(field, e.target.value)}
        className={`mt-1 block w-full p-2 border h-40 rounded-md font-mono text-sm ${jsonError[field] ? 'border-red-500' : 'border-gray-300'}`}
        disabled={isDetailsLoading}
      />
      {jsonError[field] && <p className="mt-1 text-sm text-red-600">{jsonError[field]}</p>}
    </div>
  );

  return (
    <div className="container mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Post Generation Simulation</h1>
      {error && <div className="p-4 bg-red-100 text-red-700 rounded">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Select Account (Optional)</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
              disabled={isDetailsLoading}
            >
              <option value="">-- Select an account --</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.id}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Account Concept</label>
            <textarea
              value={promptData.concept}
              onChange={(e) => setPromptData(prev => ({ ...prev, concept: e.target.value }))}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md h-24"
              disabled={isDetailsLoading}
            />
          </div>
          {renderJsonTextarea("Top Posts", "topPosts")}
          {renderJsonTextarea("Recent Posts", "recentPosts")}
          {renderJsonTextarea("Reference Posts", "referencePosts")}
          {renderJsonTextarea("Drafts to Avoid", "drafts")}
          {renderJsonTextarea("Tips", "tips")}
          {renderJsonTextarea("Exemplary Posts", "exemplaryPosts")}
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Final Prompt (Leave blank to auto-generate, or edit/paste here)
            </label>
            <textarea
              value={editablePrompt}
              onChange={(e) => setEditablePrompt(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md h-96 font-mono text-sm"
              placeholder={isPromptLoading ? "Generating prompt..." : "Prompt will be generated here..."}
              disabled={isPromptLoading}
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={isLoading || isDetailsLoading || Object.values(jsonError).some(Boolean)}
            className="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600 disabled:bg-gray-400"
          >
            {isLoading ? "Generating..." : "Generate Post"}
          </button>
          {generatedResult && (
            <div className="p-4 border border-gray-200 rounded-md space-y-4 bg-gray-50">
              <h2 className="text-lg font-semibold">Generated Result</h2>
              <div>
                <h3 className="font-bold">Tweet:</h3>
                <p className="p-2 bg-white border rounded">{generatedResult.tweet}</p>
              </div>
              <div>
                <h3 className="font-bold">Explanation:</h3>
                <p className="p-2 bg-white border rounded">{generatedResult.explanation}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
