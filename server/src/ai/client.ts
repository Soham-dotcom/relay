import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { aiEnabled, config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { GeminiProvider, type AiProvider } from './provider.js';

let provider: AiProvider | null = aiEnabled ? new GeminiProvider(config.GEMINI_API_KEY!) : null;

/** Tests inject a fake provider; null simulates "no API key configured". */
export function setAiProvider(p: AiProvider | null) {
  provider = p;
  cache.clear();
}

export function isAiAvailable() {
  return provider !== null;
}

export class AiUnavailableError extends AppError {
  constructor(reason: string) {
    // Provider errors can be long JSON blobs; the full text is in the logs, the user gets a short line.
    super(503, 'AI_UNAVAILABLE', `AI is unavailable right now: ${reason.slice(0, 120)}`);
  }
}

// ---------- Answer cache ----------
// Read-only AI answers (briefs, Ask) depend only on their prompt, and the prompt is built from the
// data. Same data + same question = same prompt, so a recent answer can be reused: faster for the
// user and it saves the free-tier quota when many people click the same demo buttons. Any change to
// the underlying data changes the prompt, so a stale answer is never served.
const CACHE_MAX = 200;
const cache = new Map<string, { value: unknown; expires: number }>();

function cacheKey(op: string, system: string, prompt: string) {
  return `${op}:${createHash('sha256').update(system).update('\0').update(prompt).digest('hex')}`;
}
function cacheGet(key: string) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}
function cacheSet(key: string, value: unknown, ttlMs: number) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!); // drop the oldest entry
  cache.set(key, { value, expires: Date.now() + ttlMs });
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
  opts: { cacheTtlMs?: number } = {},
): Promise<z.infer<S>> {
  if (!provider) throw new AiUnavailableError('no GEMINI_API_KEY configured');
  const key = opts.cacheTtlMs ? cacheKey(op, system, prompt) : null;
  const cached = key ? cacheGet(key) : undefined;
  if (cached !== undefined) {
    logger.info({ event: 'ai.cache_hit', op }, 'AI answer served from cache');
    return cached as z.infer<S>;
  }
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
        if (key) cacheSet(key, result.data, opts.cacheTtlMs!);
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
