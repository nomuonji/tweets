import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

type GrokSuggestion = {
  tweet: string;
  explanation: string;
};

export async function requestGrok(prompt: string): Promise<GrokSuggestion> {
  const { text } = await generateText({
    model: xai('grok-4-fast-non-reasoning'),
    prompt,
  });

  try {
    const json = JSON.parse(text);
    if (typeof json.tweet === 'string' && typeof json.explanation === 'string') {
      return json;
    }
    throw new Error('Invalid JSON format from Grok API.');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    throw new Error(`Failed to parse Grok API response: ${text}`);
  }
}
