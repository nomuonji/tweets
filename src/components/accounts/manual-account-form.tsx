"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { AlertIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

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

type MessageState = { type: "success" | "error"; text: string } | null;

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
        throw new Error(result.message ?? "アカウントを保存できませんでした。");
      }

      setMessage({
        type: "success",
        text: "アカウントを保存しました。ダッシュボードから同期を実行して確認してください。",
      });
      setForm(initialState);
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleFetchThreadsUserId = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/threads/user-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: form.accessToken }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "プロフィールを取得できませんでした。");
      }
      const { id, username, name } = result.profile;
      setForm((prev) => ({
        ...prev,
        userId: id,
        handle: username ?? id,
        displayName: name ?? "",
      }));
      setMessage({ type: "success", text: "プロフィールを取得しました。" });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <Field label="プラットフォーム">
        {(id) => (
          <Select
            id={id}
            value={form.platform}
            onChange={(event) =>
              handleChange("platform", event.target.value as FormState["platform"])
            }
          >
            <option value="x">X（旧 Twitter）</option>
            <option value="threads">Threads</option>
          </Select>
        )}
      </Field>

      {isThreads ? (
        <div className="space-y-1.5 rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Threads の認証情報について</p>
          <p>
            アクセストークンと合わせて、Threads の数値ユーザー ID を入力してください（例:{" "}
            <code className="rounded bg-muted px-1">31573770612207145</code>）。
          </p>
          <p>
            環境変数（THREADS_ACCESS_TOKEN / THREADS_USER_ID）でも動作しますが、
            本番ではアカウントごとに保存することを推奨します。
          </p>
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">トークンの種類</legend>
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {(
            [
              ["oauth2", "OAuth 2.0（Bearer / PKCE）"],
              ["oauth1", "OAuth 1.0a（Consumer Key + Access Token）"],
            ] as Array<[OAuthVersion, string]>
          ).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="oauth-version"
                value={value}
                checked={oauthVersion === value}
                onChange={() => setOauthVersion(value)}
                className="h-4 w-4 accent-[rgb(var(--primary))]"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="ハンドル（スクリーンネーム）">
        {(id) => (
          <Input
            id={id}
            required
            value={form.handle}
            placeholder="example_user"
            onChange={(event) => handleChange("handle", event.target.value)}
          />
        )}
      </Field>

      {isThreads ? (
        <Field
          label="Threads ユーザー ID"
          hint="アクセストークンを入力してから「取得」を押すと自動入力できます。"
        >
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                required
                value={form.userId}
                placeholder="31573770612207145"
                onChange={(event) => handleChange("userId", event.target.value)}
              />
              <Button
                variant="secondary"
                onClick={handleFetchThreadsUserId}
                disabled={loading || !form.accessToken}
              >
                取得
              </Button>
            </div>
          )}
        </Field>
      ) : null}

      <Field label="表示名（任意）">
        {(id) => (
          <Input
            id={id}
            value={form.displayName}
            placeholder="Example Inc."
            onChange={(event) => handleChange("displayName", event.target.value)}
          />
        )}
      </Field>

      {oauthVersion === "oauth1" ? (
        <Oauth1Fields form={form} onChange={handleChange} />
      ) : (
        <Oauth2Fields form={form} onChange={handleChange} />
      )}

      {form.platform === "x" ? (
        <RapidApiFields form={form} onChange={handleChange} />
      ) : null}

      <Button type="submit" className="w-full" loading={loading}>
        {loading ? "保存中..." : "保存する"}
      </Button>

      {message ? (
        <p
          className={cn(
            "flex items-start gap-2 rounded-md border p-3 text-sm",
            message.type === "success"
              ? "border-success/40 bg-success/5 text-success"
              : "border-destructive/40 bg-destructive/5 text-destructive",
          )}
        >
          {message.type === "error" ? (
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          ) : null}
          <span>{message.text}</span>
        </p>
      ) : null}
    </form>
  );
}

type FieldChange = (field: keyof FormState, value: string) => void;

type OauthFieldsProps = {
  form: FormState;
  onChange: FieldChange;
};

function FieldGroup({
  title,
  dashed,
  children,
}: {
  title: string;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-md border p-3",
        dashed ? "border-dashed border-border" : "border-border bg-muted/20",
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

function Oauth1Fields({ form, onChange }: OauthFieldsProps) {
  return (
    <FieldGroup title="OAuth 1.0a の認証情報">
      <Field label="Consumer Key（API Key）">
        {(id) => (
          <Input
            id={id}
            value={form.consumerKey}
            onChange={(event) => onChange("consumerKey", event.target.value)}
          />
        )}
      </Field>
      <Field label="Consumer Secret（API Secret）">
        {(id) => (
          <Input
            id={id}
            value={form.consumerSecret}
            onChange={(event) => onChange("consumerSecret", event.target.value)}
          />
        )}
      </Field>
      <Field label="Access Token">
        {(id) => (
          <Input
            id={id}
            value={form.accessToken}
            onChange={(event) => onChange("accessToken", event.target.value)}
          />
        )}
      </Field>
      <Field label="Access Token Secret">
        {(id) => (
          <Input
            id={id}
            value={form.accessTokenSecret}
            onChange={(event) =>
              onChange("accessTokenSecret", event.target.value)
            }
          />
        )}
      </Field>
    </FieldGroup>
  );
}

function Oauth2Fields({ form, onChange }: OauthFieldsProps) {
  return (
    <FieldGroup title="OAuth 2.0 のトークン">
      <Field label="アクセストークン（Bearer）">
        {(id) => (
          <Textarea
            id={id}
            value={form.accessToken}
            className="h-24 font-mono text-xs"
            onChange={(event) => onChange("accessToken", event.target.value)}
          />
        )}
      </Field>
      <Field label="リフレッシュトークン（任意）">
        {(id) => (
          <Textarea
            id={id}
            value={form.refreshToken}
            className="h-20 font-mono text-xs"
            onChange={(event) => onChange("refreshToken", event.target.value)}
          />
        )}
      </Field>
      <Field label="有効期限（任意）">
        {(id) => (
          <Input
            id={id}
            type="datetime-local"
            value={form.expiresAt}
            onChange={(event) => onChange("expiresAt", event.target.value)}
          />
        )}
      </Field>
      <Field label="スコープ（任意）" hint="スペースまたは改行区切り">
        {(id) => (
          <Textarea
            id={id}
            value={form.scopes}
            placeholder="tweet.read tweet.write users.read"
            className="h-20 font-mono text-xs"
            onChange={(event) => onChange("scopes", event.target.value)}
          />
        )}
      </Field>
    </FieldGroup>
  );
}

function RapidApiFields({ form, onChange }: OauthFieldsProps) {
  return (
    <FieldGroup title="RapidAPI の上書き（任意）" dashed>
      <Field label="RapidAPI キー">
        {(id) => (
          <Input
            id={id}
            value={form.rapidApiKey}
            placeholder="未入力なら RAPIDAPI_KEY 環境変数を使用"
            onChange={(event) => onChange("rapidApiKey", event.target.value)}
          />
        )}
      </Field>
      <Field label="RapidAPI ホスト">
        {(id) => (
          <Input
            id={id}
            value={form.rapidApiHost}
            placeholder="twitter-api45.p.rapidapi.com"
            onChange={(event) => onChange("rapidApiHost", event.target.value)}
          />
        )}
      </Field>
    </FieldGroup>
  );
}

type PayloadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

function buildPayload(
  form: FormState,
  oauthVersion: OAuthVersion,
): PayloadResult {
  const handle = form.handle.trim();
  if (!handle) {
    return { ok: false, error: "ハンドル（スクリーンネーム）を入力してください。" };
  }

  const displayName = form.displayName.trim();
  const userId = form.userId.trim();
  if (form.platform === "threads" && !userId) {
    return { ok: false, error: "Threads のユーザー ID を入力してください。" };
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

  const withRapidApi = (payload: Record<string, unknown>) => {
    if (form.platform !== "x") return payload;
    const rapidApiKey = form.rapidApiKey.trim();
    const rapidApiHost = form.rapidApiHost.trim();
    if (rapidApiKey) payload.rapidApiKey = rapidApiKey;
    if (rapidApiHost) payload.rapidApiHost = rapidApiHost;
    return payload;
  };

  if (oauthVersion === "oauth1") {
    const consumerKey = form.consumerKey.trim();
    const consumerSecret = form.consumerSecret.trim();
    const accessToken = form.accessToken.trim();
    const accessTokenSecret = form.accessTokenSecret.trim();

    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
      return {
        ok: false,
        error:
          "OAuth 1.0a では Consumer Key / Consumer Secret / Access Token / Access Token Secret のすべてが必要です。",
      };
    }

    return {
      ok: true,
      data: withRapidApi({
        ...base,
        accessToken,
        consumerKey,
        consumerSecret,
        accessTokenSecret,
      }),
    };
  }

  const accessToken = form.accessToken.trim();
  if (!accessToken) {
    return { ok: false, error: "アクセストークンを入力してください。" };
  }

  const refreshToken = form.refreshToken.trim();
  const expiresAt = form.expiresAt.trim();
  const scopes = form.scopes
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    ok: true,
    data: withRapidApi({
      ...base,
      accessToken,
      refreshToken: refreshToken || undefined,
      expiresAt: expiresAt || undefined,
      scopes,
    }),
  };
}
