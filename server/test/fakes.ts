import type { AiProvider } from '../src/ai/provider.js';

/** A provider that returns scripted replies in order, so retry behaviour can be tested. */
export function scripted(replies: (string | Error)[]): AiProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    model: 'fake',
    calls,
    async generateText(_s, prompt) {
      calls.push(prompt);
      const next = replies.shift();
      if (next === undefined) throw new Error('no more scripted replies');
      if (next instanceof Error) throw next;
      return next;
    },
    async embed(texts) {
      return texts.map(() => []);
    },
  };
}
