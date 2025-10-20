"use client";

import { useState } from "react";

type OAuthVersion = "oauth2" | "oauth1";

type FormState = {
  platform: "x" | "threads";
  handle: string;
  displayName: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string;
  consumerKey: string;
  consumerSecret: string;
  accessTokenSecret: string;
  rapidApiKey: string;
  rapidApiHost: string;
};

type MessageState =
  | {
      type: "success" | "error";
      text: string;
    }
  | null;

const initialState: FormState = {
  platform: "x",
  handle: "",
  displayName: "",
  userId: "",
  accessToken: "",
  refreshToken: "",
  expiresAt: "",
  scopes: "",
  consumerKey: "",
  consumerSecret: "",
  accessTokenSecret: "",
  rapidApiKey: "",
  rapidApiHost: "",
};

export function ManualAccountForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [oauthVersion, setOauthVersion] = useState<OAuthVersion>("oauth2");
  const [message, setMessage] = useState<MessageState>(null);
  const [loading, setLoading] = useState(false);
  const isThreads = form.platform === "threads";

  const handleChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const payload = buildPayload(form, oauthVersion);
    if (!payload.ok) {
      setMessage({ type: "error", text: payload.error });
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.data),
      });

      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Failed to save account.");
      }

      setMessage({
        type: "success",
        text: "Account saved. Run a sync from the dashboard to verify.",
      });
      setForm(initialState);
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-foreground">Platform</span>
          <select
            value={form.platform}
            onChange={(event) =>
              handleChange("platform", event.target.value as FormState["platform"])
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="x">X (Twitter)</option>
            <option value="threads">Threads</option>
          </select>
        </label>

        {isThreads ? (
          <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Threads credential tips</p>
            <p>
              Provide the Threads numeric user ID alongside the access token. You can reuse the values from Meta&apos;s dashboard (example: <code>31573770612207145</code>).
            </p>
            <p>
              Environment fallbacks (`THREADS_ACCESS_TOKEN` / `THREADS_USER_ID`) remain available for quick testing, but saving account-specific tokens here is recommended in production.
            </p>
          </div>
        ) : null}

        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium text-foreground">Token type</legend>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="oauth-version"
                value="oauth2"
                checked={oauthVersion === "oauth2"}
                onChange={() => setOauthVersion("oauth2")}
              />
              <span>OAuth 2.0 (Bearer / PKCE)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="oauth-version"
                value="oauth1"
                checked={oauthVersion === "oauth1"}
                onChange={() => setOauthVersion("oauth1")}
              />
              <span>OAuth 1.0a (Consumer Key + Access Token)</span>
            </label>
          </div>
        </fieldset>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-foreground">Handle (screen name)</span>
          <input
            value={form.handle}
            onChange={(event) => handleChange("handle", event.target.value)}
            placeholder="example_user"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
          />
        </label>

        {isThreads ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium text-foreground">Threads user ID</span>
            <input
              value={form.userId}
              onChange={(event) => handleChange("userId", event.target.value)}
              placeholder="31573770612207145"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
        ) : null}

        <label className="space-y-1 text-sm">
          <span className="font-medium text-foreground">Display name (optional)</span>
          <input
            value={form.displayName}
            onChange={(event) => handleChange("displayName", event.target.value)}
            placeholder="Example Inc."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        {oauthVersion === "oauth1" ? (
          <Oauth1Fields form={form} onChange={handleChange} />
        ) : (
          <Oauth2Fields form={form} onChange={handleChange} />
        )}

        {form.platform === "x" && (
          <RapidApiFields form={form} onChange={handleChange} />
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Saving..." : "Save to Firestore"}
      </button>

      {message && (
        <p
          className={`text-sm ${
            message.type === "success" ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}

type FieldChange = (field: keyof FormState, value: string) => void;

type OauthFieldsProps = {
  form: FormState;
  onChange: FieldChange;
};

function Oauth1Fields({ form, onChange }: OauthFieldsProps) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <p className="text-sm font-medium text-foreground">OAuth 1.0a credentials</p>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Consumer Key (API Key)</span>
        <input
          value={form.consumerKey}
          onChange={(event) => onChange("consumerKey", event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Consumer Secret (API Secret)</span>
        <input
          value={form.consumerSecret}
          onChange={(event) => onChange("consumerSecret", event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Access Token</span>
        <input
          value={form.accessToken}
          onChange={(event) => onChange("accessToken", event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Access Token Secret</span>
        <input
          value={form.accessTokenSecret}
          onChange={(event) => onChange("accessTokenSecret", event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}

function Oauth2Fields({ form, onChange }: OauthFieldsProps) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <p className="text-sm font-medium text-foreground">OAuth 2.0 tokens</p>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Access token (Bearer)</span>
        <textarea
          value={form.accessToken}
          onChange={(event) => onChange("accessToken", event.target.value)}
          className="h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Refresh token (optional)</span>
        <textarea
          value={form.refreshToken}
          onChange={(event) => onChange("refreshToken", event.target.value)}
          className="h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Expiry (ISO 8601, optional)</span>
        <input
          type="datetime-local"
          value={form.expiresAt}
          onChange={(event) => onChange("expiresAt", event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">
          Scopes (space or newline separated, optional)
        </span>
        <textarea
          value={form.scopes}
          onChange={(event) => onChange("scopes", event.target.value)}
          placeholder="tweet.read tweet.write users.read"
          className="h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}

function RapidApiFields({ form, onChange }: OauthFieldsProps) {
  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <p className="text-sm font-medium text-foreground">
        RapidAPI override (optional)
      </p>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">RapidAPI key</span>
        <input
          value={form.rapidApiKey}
          onChange={(event) => onChange("rapidApiKey", event.target.value)}
          placeholder="Defaults to RAPIDAPI_KEY env"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">RapidAPI host</span>
        <input
          value={form.rapidApiHost}
          onChange={(event) => onChange("rapidApiHost", event.target.value)}
          placeholder="twitter-api45.p.rapidapi.com"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}

type PayloadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

function buildPayload(form: FormState, oauthVersion: OAuthVersion): PayloadResult {
  const handle = form.handle.trim();
  if (!handle) {
    return { ok: false, error: "Enter a handle (screen name)." };
  }

  const displayName = form.displayName.trim();
  const userId = form.userId.trim();
  if (form.platform === "threads" && !userId) {
    return { ok: false, error: "Enter a Threads user ID." };
  }

  const base = {
    platform: form.platform,
    handle,
    displayName: displayName || undefined,
    oauthVersion,
  } as Record<string, unknown>;

  if (userId && form.platform === "threads") {
    base.userId = userId;
  }

  if (oauthVersion === "oauth1") {
    const consumerKey = form.consumerKey.trim();
    const consumerSecret = form.consumerSecret.trim();
    const accessToken = form.accessToken.trim();
    const accessTokenSecret = form.accessTokenSecret.trim();

    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
      return {
        ok: false,
        error:
          "For OAuth 1.0a, provide Consumer Key, Consumer Secret, Access Token, and Access Token Secret.",
      };
    }

    const payload: Record<string, unknown> = {
      ...base,
      accessToken,
      consumerKey,
      consumerSecret,
      accessTokenSecret,
    };

    if (form.platform === "x") {
      const rapidApiKey = form.rapidApiKey.trim();
      const rapidApiHost = form.rapidApiHost.trim();
      if (rapidApiKey) {
        payload.rapidApiKey = rapidApiKey;
      }
      if (rapidApiHost) {
        payload.rapidApiHost = rapidApiHost;
      }
    }

    return { ok: true, data: payload };
  }

  const accessToken = form.accessToken.trim();
  if (!accessToken) {
    return { ok: false, error: "Enter an access token." };
  }

  const refreshToken = form.refreshToken.trim();
  const expiresAt = form.expiresAt.trim();
  const scopes = form.scopes
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  const payload: Record<string, unknown> = {
    ...base,
    accessToken,
    refreshToken: refreshToken || undefined,
    expiresAt: expiresAt || undefined,
    scopes,
  };

  if (form.platform === "x") {
    const rapidApiKey = form.rapidApiKey.trim();
    const rapidApiHost = form.rapidApiHost.trim();
    if (rapidApiKey) {
      payload.rapidApiKey = rapidApiKey;
    }
    if (rapidApiHost) {
      payload.rapidApiHost = rapidApiHost;
    }
  }

  return { ok: true, data: payload };
}
