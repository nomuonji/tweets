import { createHash, createHmac, timingSafeEqual } from "crypto";

const ACCESS_SCOPE = "tweets-operator";

function secret() {
  const value = process.env.AGENT_MCP_TOKEN?.trim();
  if (!value) throw new Error("AGENT_MCP_TOKEN is required for OAuth");
  return value;
}

function b64(value: string) {
  return Buffer.from(value).toString("base64url");
}

function unb64(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function signOAuthToken(kind: "code" | "access" | "refresh", claims: Record<string, unknown>) {
  const ttl =
    kind === "refresh" ? 60 * 60 * 24 * 30 :
    kind === "access" ? 60 * 60 :
    5 * 60;
  const body = b64(JSON.stringify({
    kind,
    exp: Math.floor(Date.now() / 1000) + ttl,
    ...claims,
  }));
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyOAuthToken(value: string, kind: "code" | "access" | "refresh") {
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) return null;

  try {
    const payload = JSON.parse(unb64(body));
    if (
      payload.kind !== kind ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function oauthAccessTokenValid(value: string) {
  return Boolean(verifyOAuthToken(value, "access"));
}

export function oauthScope() {
  return ACCESS_SCOPE;
}

export function oauthOrigin(request: Request) {
  return new URL(request.url).origin;
}

export function safeRedirect(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url;
    if (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) return url;
    return null;
  } catch {
    return null;
  }
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function sameAccessKey(value: string) {
  const expected = secret();
  return (
    value.length === expected.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

export function oauthMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [ACCESS_SCOPE],
  };
}
