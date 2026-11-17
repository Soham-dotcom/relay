import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * The only two things the app needs from a model. Keeping the interface this small means
 * Gemini can be swapped for another provider (or a fake in tests) without touching services.
 */
export interface AiProvider {
  /** The model that answered the most recent call (used in logs). */
  readonly model: string;
  generateText(system: string, prompt: string): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBED_DIM = 768;

/** Errors worth trying another model for: retired (404), quota/rate limit (429), overloaded (503). */
export function isModelUnavailable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /\b(404|429|503)\b|NOT_FOUND|RESOURCE_EXHAUSTED|UNAVAILABLE|no longer available|high demand/i.test(text);
}

/**
 * Calls `run` with each model in order until one answers. Only "this model can't serve you right now"
 * errors move on to the next model; anything else (bad request, network) is thrown straight away,
 * because another model would fail the same way.
 */
export async function withModelFallback<T>(models: string[], run: (model: string) => Promise<T>, onFallback?: (from: string, err: unknown) => void) {
  let lastErr: unknown;
  for (const [i, model] of models.entries()) {
    try {
      return { model, value: await run(model) };
    } catch (err) {
      lastErr = err;
      if (!isModelUnavailable(err) || i === models.length - 1) throw err;
      onFallback?.(model, err);
    }
  }
  throw lastErr;
}

export class GeminiProvider implements AiProvider {
  private client: GoogleGenAI;
  /** GEMINI_MODEL may list several models, comma-separated, in order of preference. */
  private models = config.GEMINI_MODEL.split(',').map((m) => m.trim()).filter(Boolean);
  model = this.models[0];

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateText(system: string, prompt: string): Promise<string> {
    const { model, value } = await withModelFallback(
      this.models,
      async (m) => {
        const res = await this.client.models.generateContent({
          model: m,
          contents: prompt,
          config: { systemInstruction: system, responseMimeType: 'application/json', temperature: 0.2 },
        });
        return res.text ?? '';
      },
      (from, err) =>
        logger.warn({ event: 'ai.model_fallback', from, reason: (err as Error).message.slice(0, 160) }, 'model unavailable, trying the next one'),
    );
    this.model = model;
    return value;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.models.embedContent({
      model: config.GEMINI_EMBED_MODEL,
      contents: texts,
      config: { outputDimensionality: EMBED_DIM },
    });
    const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
    if (vectors.length !== texts.length) throw new Error('Embedding count mismatch');
    return vectors;
  }
}
