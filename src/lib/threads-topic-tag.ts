/**
 * Normalize a Threads topic tag accepted by the Threads API.
 * Meta's API accepts one 1–50 character topic per post and rejects "." and "&".
 * Spaces are preserved because topics may be multi-word phrases.
 */
export function normalizeThreadsTopicTag(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const topic = value.trim().replace(/^#+/, "").trim();
  if (!topic) return undefined;
  if (Array.from(topic).length > 50) return undefined;
  if (/[.&]/.test(topic)) return undefined;
  return topic;
}
