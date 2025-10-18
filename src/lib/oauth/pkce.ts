import crypto from "node:crypto";

export function createState(size = 32) {
  return crypto.randomBytes(size).toString("hex");
}

export function createCodeVerifier(size = 64) {
  return base64UrlEncode(crypto.randomBytes(size));
}

export function createCodeChallenge(codeVerifier: string) {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
