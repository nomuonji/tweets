import type { DraftDoc, ExemplaryPost, PostDoc, Tip } from "@/lib/types";

export function buildPrompt(
  topPosts: PostDoc[],
  referencePosts: Tip[],
  recentPosts: PostDoc[],
  drafts: DraftDoc[],
  extraAvoid: string[],
  tips: Tip[],
  exemplaryPosts: ExemplaryPost[],
  concept?: string,
  minPostLength = 1,
  maxPostLength = 240,
) {
  const targetLength = Math.floor(Math.random() * (maxPostLength - minPostLength + 1)) + minPostLength;

  // 1. Reference Information (Unified Input)
  const conceptSection = concept ? `\n[Account Concept]\n${concept}\n` : "";

  const styleSamples = [
      ...exemplaryPosts.map(p => `- ${p.text}`),
      ...topPosts.map(p => `- ${p.text}`)
  ];
  const styleSection = styleSamples.length > 0
      ? `\n[Style Samples & Past Hits]\n${styleSamples.join("\n")}\n`
      : "";

  const ideaSamples = [
      ...tips.map(t => `- ${t.text}`),
      ...referencePosts.map(r => `- ${r.text}`)
  ];
  const ideaSection = ideaSamples.length > 0
      ? `\n[Topic Ideas & Inspiration]\n${ideaSamples.join("\n")}\n`
      : "";

  const inputValuesBlock = `
# 1. REFERENCE INFORMATION
Use the following information as the sole source of truth for the account's persona, style, and potential topics.
${conceptSection}${styleSection}${ideaSection}`;

  // 2. Negative Constraints (Avoidance)
  const avoidTexts = [
      ...recentPosts.map(p => p.text),
      ...drafts.map(d => d.text),
      ...extraAvoid
  ].filter(Boolean);

  // Deduplicate and limit
  const uniqueAvoid = Array.from(new Set(avoidTexts)).slice(0, 30);

  const avoidanceBlock = uniqueAvoid.length > 0
      ? `\n# 2. ANTI-PATTERNS (DUPLICATION PREVENTION)\nDo NOT repeat the content, specific phrases, or sentence starters found in these text:\n${uniqueAvoid.map(t => `- ${t.replace(/\s+/g, " ").slice(0, 100)}`).join("\n")}\n`
      : "";

  return `
You are a creative social media content generator.

${inputValuesBlock}
${avoidanceBlock}

# 3. TASK
Generate ONE new post based on the "REFERENCE INFORMATION" above, while strictly following these constraints:
1.  **Length:** Approximately **${targetLength} characters** (Max ${maxPostLength}).
2.  **Uniqueness:** Ensure the content is distinct from the "ANTI-PATTERNS".
3.  **Language:** Japanese.
4.  **Format:** Output ONLY a JSON object.

Output Format:
{
  "tweet": "Post text...",
  "explanation": "Brief reasoning (max 100 chars)"
}
`;
}
