import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, generateJson, setAiProvider, AiUnavailableError } from '../src/ai/client.js';
import { cosine, keywordScore, rankCandidates } from '../src/lib/similarity.js';
import { matchOwner } from '../src/services/recap.js';
import { scripted } from './fakes.js';

afterEach(() => setAiProvider(null));

describe('generateJson', () => {
  const schema = z.object({ answer: z.number() });

  it('returns validated output', async () => {
    setAiProvider(scripted(['{"answer": 42}']));
    await expect(generateJson('t', schema, 's', 'p')).resolves.toEqual({ answer: 42 });
  });

  it('retries once with the validation error, then succeeds', async () => {
    const p = scripted(['{"answer": "forty-two"}', '```json\n{"answer": 42}\n```']);
    setAiProvider(p);
    await expect(generateJson('t', schema, 's', 'p')).resolves.toEqual({ answer: 42 });
    expect(p.calls[1]).toContain('previous reply was rejected');
  });

  it('gives up with AI_UNAVAILABLE after two bad replies or errors', async () => {
    setAiProvider(scripted(['not json', new Error('503 from provider')]));
    await expect(generateJson('t', schema, 's', 'p')).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('reports AI_UNAVAILABLE when no key is configured', async () => {
    setAiProvider(null);
    await expect(generateJson('t', schema, 's', 'p')).rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' });
  });
});

describe('helpers', () => {
  it('extractJson tolerates code fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('matchOwner prefers full name, then a unique first name, else null', () => {
    const people = [
      { id: '1', name: 'Priya Sharma' },
      { id: '2', name: 'Rahul Mehta' },
      { id: '3', name: 'Rahul Verma' },
    ];
    expect(matchOwner('priya sharma', people)?.id).toBe('1');
    expect(matchOwner('Priya', people)?.id).toBe('1');
    expect(matchOwner('Rahul', people)).toBeNull(); // ambiguous: do not guess
    expect(matchOwner('Sam', people)).toBeNull();
    expect(matchOwner(null, people)).toBeNull();
  });

  it('similarity: cosine for vectors, keyword overlap as fallback', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(keywordScore('webhook replay script', 'Runbook: replay failed webhook events')).toBeCloseTo(2 / 3);
    const ranked = rankCandidates({ text: 'webhook retries', vector: null }, ['webhook retries runbook', 'release process'], (t) => ({ text: t, vector: [] }), 5);
    expect(ranked.map((r) => r.item)).toEqual(['webhook retries runbook']);
  });
});
