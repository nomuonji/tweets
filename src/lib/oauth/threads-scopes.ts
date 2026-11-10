export const REQUIRED_THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
] as const;

/**
 * Preserve any extra scopes already configured while ensuring the Threads
 * account keeps its publishing capability and can read post/account insights.
 * Meta's Threads OAuth authorization endpoint expects comma-separated scopes.
 */
export function resolveThreadsOAuthScopes(
  configured: string | undefined = process.env.THREADS_SCOPES,
): string[] {
  const requested = (configured ?? "")
    .split(/[\\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return Array.from(new Set([...requested, ...REQUIRED_THREADS_SCOPES]));
}
