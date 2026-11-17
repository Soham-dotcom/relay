import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, generateJson, setAiProvider, AiUnavailableError } from '../src/ai/client.js';
import { cosine, keywordScore, rankCandidates } from '../src/lib/similarity.js';
import { matchOwner } from '../src/services/recap.js';
import { filterOwnActivity } from '../src/services/activity.js';
import { withModelFallback } from '../src/ai/provider.js';
import { scripted } from './fakes.js';
import { makePdf } from './fixtures.js';
import { extractText } from '../src/lib/extract.js';
import { chunkText } from '../src/lib/chunk.js';

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

describe('file text extraction and chunking', () => {
  it('reads the text of a real PDF', async () => {
    const { text, kind, pages } = await extractText(makePdf(['Refund policy for failed debits.', 'Refunds are paid within 3 working days.']), 'Policy.pdf');
    expect(kind).toBe('pdf');
    expect(pages).toBe(1);
    expect(text).toContain('within 3 working days');
  });

  it('reads plain text and Markdown files', async () => {
    const { text, kind } = await extractText(Buffer.from('# Runbook\nRestart the worker, then replay failed events.'), 'runbook.md');
    expect(kind).toBe('text');
    expect(text).toContain('replay failed events');
  });

  it('rejects unsupported types, renamed files and empty files with clear errors', async () => {
    await expect(extractText(Buffer.from('MZ binary'), 'tool.exe')).rejects.toMatchObject({ status: 415, code: 'UNSUPPORTED_FILE' });
    await expect(extractText(Buffer.from('just text, not a pdf at all'), 'fake.pdf')).rejects.toMatchObject({ status: 415 });
    await expect(extractText(Buffer.from('   '), 'empty.txt')).rejects.toMatchObject({ status: 422, code: 'NO_TEXT' });
  });

  it('keeps a short document as one passage', () => {
    expect(chunkText('A short note about the release process.')).toHaveLength(1);
  });

  it('splits a long document into overlapping passages without losing text', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: ${'details about the payment system. '.repeat(4)}`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, 1200, 150);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1200)).toBe(true);
    // Every paragraph label survives somewhere, and passages overlap.
    for (let i = 1; i <= 30; i++) expect(chunks.some((c) => c.includes(`Paragraph ${i}:`))).toBe(true);
    expect(chunks[1].slice(0, 40)).not.toBe(chunks[0].slice(0, 40));
  });
});

describe('model fallback and answer cache', () => {
  it('moves to the next model only when a model is retired, rate-limited or overloaded', async () => {
    const tried: string[] = [];
    const res = await withModelFallback(['old', 'busy', 'good'], async (m) => {
      tried.push(m);
      if (m === 'old') throw new Error('{"error":{"code":404,"message":"no longer available"}}');
      if (m === 'busy') throw new Error('429 RESOURCE_EXHAUSTED');
      return 'answer';
    });
    expect(res).toEqual({ model: 'good', value: 'answer' });
    expect(tried).toEqual(['old', 'busy', 'good']);
  });

  it('does not try other models for an ordinary error', async () => {
    const tried: string[] = [];
    await expect(
      withModelFallback(['a', 'b'], async (m) => {
        tried.push(m);
        throw new Error('400 invalid argument');
      }),
    ).rejects.toThrow('400');
    expect(tried).toEqual(['a']);
  });

  it('reuses a cached answer for an identical prompt, not for a different one', async () => {
    const p = scripted(['{"answer": 1}', '{"answer": 2}']);
    setAiProvider(p);
    const schema = z.object({ answer: z.number() });
    const opts = { cacheTtlMs: 60_000 };
    expect(await generateJson('t', schema, 's', 'same', opts)).toEqual({ answer: 1 });
    expect(await generateJson('t', schema, 's', 'same', opts)).toEqual({ answer: 1 });
    expect(await generateJson('t', schema, 's', 'different', opts)).toEqual({ answer: 2 });
    expect(p.calls).toHaveLength(2);
  });
});

describe('activity log filter', () => {
  const lines = [
    { requestId: 'r1', userId: 'me', time: '2026-10-30T10:00:00Z', event: 'ai.call', op: 'brief.generate', latencyMs: 900, outcome: 'ok' },
    { requestId: 'r1', time: '2026-10-30T10:00:01Z', req: { method: 'POST', url: '/api/sessions/s/brief' }, res: { statusCode: 200 }, responseTime: 950 },
    { requestId: 'r2', userId: 'someone-else', time: '2026-10-30T10:01:00Z', event: 'item.closed' },
    { requestId: 'r2', time: '2026-10-30T10:01:01Z', req: { method: 'PATCH', url: '/api/items/x' }, res: { statusCode: 200 } },
  ];

  it("returns only my requests, grouped, with the access line's method, url and status", () => {
    const out = filterOwnActivity(lines, 'me');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ requestId: 'r1', method: 'POST', status: 200, durationMs: 950 });
    expect(out[0].events[0]).toMatchObject({ event: 'ai.call', latencyMs: 900 });
  });

  it("never returns someone else's request, even when asked for its id", () => {
    expect(filterOwnActivity(lines, 'me', 'r2')).toEqual([]);
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
