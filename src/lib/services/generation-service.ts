import OpenAI from "openai";
import cosineSimilarity from "cosine-similarity";
import { randomUUID } from "crypto";
import { DateTime } from "luxon";
import type { DraftDoc, PostDoc, SettingsDoc } from "@/lib/types";
import { saveDraft } from "./firestore.server";

type GenerationContext = {
  basePost: PostDoc;
  settings: SettingsDoc["generation"];
  createdBy: string;
  targetPlatform: "x" | "threads";
};

type GeneratedIdea = {
  variation: "short" | "assertive" | "question";
  text: string;
  hashtags: string[];
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey });
}

function getEmbeddingModel() {
  return process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
}

function getGenerationModel() {
  return process.env.GENERATION_MODEL ?? "gpt-4o-mini";
}

async function buildIdeas(context: GenerationContext): Promise<GeneratedIdea[]> {
  const client = getOpenAIClient();
  const lengthMin = context.settings.preferred_length[0];
  const lengthMax = context.settings.preferred_length[1];

  const userPrompt = `Base post:\n${context.basePost.text}\n\nPlatform: ${context.targetPlatform}\nLength target: ${lengthMin}-${lengthMax} characters.\nRules:\n- Start with a strong hook (number / assertion / question).\n- Provide value before any URL.\n- Limit hashtags to ${context.settings.max_hashtags} (use zero when not needed).\n- Return exactly three options covering: short, assertive, and question styles.\nRespond with valid JSON only using this schema: { "ideas": [ { "variation": "short|assertive|question", "text": string, "hashtags": string[] } ] }.`;

  const response = await client.chat.completions.create({
    model: getGenerationModel(),
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "You generate engaging Japanese social posts for X or Threads. Keep tone aligned with the source post and follow channel constraints strictly.",
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const message = response.choices[0]?.message?.content;
  if (!message) {
    throw new Error("No generation response received");
  }

  const trimmed = message.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Failed to parse generation output as JSON");
  }

  const jsonText = trimmed.slice(start, end + 1);
  const data = JSON.parse(jsonText) as { ideas: GeneratedIdea[] };
  return data.ideas;
}

async function computeSimilarity(a: string, b: string) {
  const client = getOpenAIClient();
  const embeddingModel = getEmbeddingModel();
  const [source, target] = await Promise.all([
    client.embeddings.create({
      model: embeddingModel,
      input: a,
    }),
    client.embeddings.create({
      model: embeddingModel,
      input: b,
    }),
  ]);

  const sourceVector = source.data[0]?.embedding ?? [];
  const targetVector = target.data[0]?.embedding ?? [];
  return cosineSimilarity(sourceVector, targetVector);
}

export async function generateDrafts(context: GenerationContext) {
  const ideas = await buildIdeas(context);

  const drafts: DraftDoc[] = [];

  for (const idea of ideas) {
    const similarity = await computeSimilarity(context.basePost.text, idea.text);
    drafts.push({
      id: randomUUID(),
      target_platform: context.targetPlatform,
      base_post_id: context.basePost.id,
      text: idea.text,
      hashtags: idea.hashtags.slice(0, context.settings.max_hashtags),
      status: "draft",
      schedule_time: null,
      created_by: context.createdBy,
      created_at: DateTime.utc().toISO(),
      updated_at: DateTime.utc().toISO(),
      similarity_warning: similarity >= 0.8,
    });
  }

  for (const draft of drafts) {
    await saveDraft(draft);
  }

  return drafts;
}
