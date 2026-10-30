import type { z } from 'zod';
import { aiEnabled, config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { GeminiProvider, type AiProvider } from './provider.js';

let provider: AiProvider | null = aiEnabled ? new GeminiProvider(config.GEMINI_API_KEY!) : null;

/** Tests inject a fake provider; null simulates "no API key configured". */
export function setAiProvider(p: AiProvider | null) {
  provider = p;
}

export function isAiAvailable() {
  return provider !== null;
}

export class AiUnavailableError extends AppError {
  constructor(reason: string) {
    super(503, 'AI_UNAVAILABLE', `AI is unavailable right now: ${reason}`);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Pulls a JSON value out of model text, tolerating ```json fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

/**
 * Ask the model for JSON and validate it against a schema.
 * The model's output is never trusted as-is: if it is not valid JSON or does not match
 * the schema, we retry once with the validation error, then give up with AI_UNAVAILABLE.
 */
export async function generateJson<S extends z.ZodTypeAny>(
  op: string,
  schema: S,
  system: string,
  prompt: string,
): Promise<z.infer<S>> {
  if (!provider) throw new AiUnavailableError('no GEMINI_API_KEY configured');
  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const fullPrompt =
      attempt === 1
        ? prompt
        : `${prompt}\n\nYour previous reply was rejected: ${lastError}\nReply again with ONLY valid JSON matching the requested shape.`;
    const started = Date.now();
    try {
      const text = await withTimeout(provider.generateText(system, fullPrompt), config.AI_TIMEOUT_MS);
      const result = schema.safeParse(extractJson(text));
      const latencyMs = Date.now() - started;
      if (result.success) {
        logger.info({ event: 'ai.call', op, model: provider.model, attempt, latencyMs, outcome: 'ok' }, 'AI call succeeded');
        return result.data;
      }
      lastError = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      logger.warn({ event: 'ai.call', op, model: provider.model, attempt, latencyMs, outcome: 'invalid_output', issues: lastError }, 'AI output failed validation');
    } catch (err) {
      lastError = err instanceof SyntaxError ? 'reply was not valid JSON' : (err as Error).message;
      const outcome = err instanceof SyntaxError ? 'invalid_output' : 'error';
      logger.warn({ event: 'ai.call', op, model: provider.model, attempt, latencyMs: Date.now() - started, outcome, error: lastError }, 'AI call failed');
    }
  }
  logger.error({ event: 'ai.failed', op }, 'AI gave up after retry');
  throw new AiUnavailableError(lastError);
}

/** Embeddings are best-effort: null means "use the keyword fallback", never a failed request. */
export async function embedTexts(op: string, texts: string[]): Promise<number[][] | null> {
  if (!provider || texts.length === 0) return null;
  const started = Date.now();
  try {
    const vectors = await withTimeout(provider.embed(texts), config.AI_TIMEOUT_MS);
    logger.info({ event: 'ai.embed', op, count: texts.length, latencyMs: Date.now() - started, outcome: 'ok' }, 'embedding succeeded');
    return vectors;
  } catch (err) {
    logger.warn({ event: 'ai.embed', op, count: texts.length, latencyMs: Date.now() - started, outcome: 'error', error: (err as Error).message }, 'embedding failed, using keyword fallback');
    return null;
  }
}
