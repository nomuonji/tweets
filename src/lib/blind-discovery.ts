import { createHash } from "node:crypto";

export interface BlindDiscoverySeed {
  id: string;
  query: string;
  theme: string;
  language: "ja" | "en";
}

export const BLIND_DISCOVERY_SEEDS: readonly BlindDiscoverySeed[] = [
  { id: "ja-unexpected", query: "思ってたのと違う", theme: "everyday surprises", language: "ja" },
  { id: "en-unexpected", query: '"I didn't expect"', theme: "everyday surprises", language: "en" },
  { id: "ja-useful", query: "地味に便利", theme: "small inventions and utility", language: "ja" },
  { id: "en-useful", query: '"unexpectedly useful"', theme: "small inventions and utility", language: "en" },
  { id: "ja-friction", query: "地味に困る", theme: "everyday friction", language: "ja" },
  { id: "en-friction", query: '"why is it so hard"', theme: "everyday friction", language: "en" },
  { id: "ja-realization", query: "言われてみれば", theme: "shared realizations", language: "ja" },
  { id: "en-realization", query: '"I never realized"', theme: "shared realizations", language: "en" },
  { id: "ja-design", query: "これ考えた人", theme: "design and human ingenuity", language: "ja" },
  { id: "en-design", query: '"whoever designed this"', theme: "design and human ingenuity", language: "en" },
  { id: "ja-memory", query: "なぜか覚えてる", theme: "memory and culture", language: "ja" },
  { id: "en-memory", query: '"this lives rent free"', theme: "memory and culture", language: "en" },
  { id: "ja-consumer", query: "買ってよかった", theme: "consumer experience", language: "ja" },
  { id: "en-consumer", query: '"worth every penny"', theme: "consumer experience", language: "en" },
  { id: "ja-odd", query: "二度見した", theme: "odd observations", language: "ja" },
  { id: "en-odd", query: '"I had to look twice"', theme: "odd observations", language: "en" },
  { id: "ja-social", query: "そういうところ好き", theme: "social interaction", language: "ja" },
  { id: "en-social", query: '"that was surprisingly kind"', theme: "social interaction", language: "en" },
  { id: "ja-hack", query: "もっと早く知りたかった", theme: "learned tricks", language: "ja" },
  { id: "en-hack", query: '"wish I knew this sooner"', theme: "learned tricks", language: "en" },
] as const;

export interface BlindDiscoveryPlan {
  seed: BlindDiscoverySeed;
  queryId: string;
  runId: string;
  lanes: readonly ["Top", "Latest"];
  nextCursorIndex: number;
}

export function buildBlindDiscoveryPlan(
  cursorIndex: number,
  jstDate: string,
): BlindDiscoveryPlan {
  if (!Number.isInteger(cursorIndex) || cursorIndex < 0) {
    throw new Error("Blind discovery cursor must be a non-negative integer.");
  }
  if (!/^\d{4}-\\d{2}-\\d{2}$/.test(jstDate)) {
    throw new Error("Blind discovery date must be a JST YYYY-MM-DD value.");
  }
  const index = cursorIndex % BLIND_DISCOVERY_SEEDS.length;
  const seed = BLIND_DISCOVERY_SEEDS[index];
  const queryDigest = createHash("sha256")
    .update(`${seed.id}\\n${seed.query}`)
    .digest("hex")
    .slice(0, 32);
  const queryId = `blind:v1:${seed.id}:${queryDigest}`;
  return {
    seed,
    queryId,
    runId: `blind_${jstDate.replace(/-/g, "")}_${seed.id}`,
    lanes: ["Top", "Latest"],
    nextCursorIndex: (index + 1) % BLIND_DISCOVERY_SEEDS.length,
  };
}

export function buildBlindObservationId(
  runId: string,
  platformPostId: string,
  lane: "Top" | "Latest",
): string {
  const digest = createHash("sha256")
    .update(`${runId}\\n${platformPostId}\\n${lane}`)
    .digest("hex")
    .slice(0, 40);
  return `blindobs_${digest}`;
}

export function hashBlindSourceText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
