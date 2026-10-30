import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

/**
 * The only two things the app needs from a model. Keeping the interface this small means
 * Gemini can be swapped for another provider (or a fake in tests) without touching services.
 */
export interface AiProvider {
  readonly model: string;
  generateText(system: string, prompt: string): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBED_DIM = 768;

export class GeminiProvider implements AiProvider {
  private client: GoogleGenAI;
  readonly model = config.GEMINI_MODEL;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateText(system: string, prompt: string): Promise<string> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });
    return res.text ?? '';
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
