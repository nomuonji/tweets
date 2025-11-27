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

  // --- Part 2: Input Values (Source Material) ---
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
# 2. INPUT VALUES (SOURCE MATERIAL)
Use these values as the content and style source.
${conceptSection}`;

  // --- Part 3: Past Posts (Duplication Prevention) ---
  const avoidTexts = [
      ...recentPosts.map(p => p.text),
      ...drafts.map(d => d.text),
      ...extraAvoid
  ].filter(Boolean);

  // Deduplicate and limit
  const uniqueAvoid = Array.from(new Set(avoidTexts)).slice(0, 30);

  const avoidanceBlock = uniqueAvoid.length > 0
      ? `\n# 3. PAST POSTS (DUPLICATION PREVENTION)\nAVOID repeating the content or phrasing of these posts:\n${uniqueAvoid.map(t => `- ${t.replace(/\s+/g, " ").slice(0, 100)}`).join("\n")}\n`
      : `\n# 3. PAST POSTS (DUPLICATION PREVENTION)\n(No recent posts to avoid)\n`;

  return `
You are a creative social media content generator.

# 1. TARGET CHARACTER COUNT
Target: ${targetLength} characters (Absolute Max: ${maxPostLength})

${inputValuesBlock}
${avoidanceBlock}

# TASK
Generate ONE new post that:
1. Matches the length in #1.
2. Uses the persona/style/ideas from #2.
3. Is NOT similar to any post in #3.
4. Language: Japanese.

Output strictly in JSON:
{
  "tweet": "Content...",
  "explanation": "Reasoning..."
}
`;
}
