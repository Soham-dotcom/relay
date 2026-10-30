import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, type AskResult, type AskSource } from '../api';
import { Button, Card, ErrorBox, inputCls } from '../ui';

const EXAMPLES = ['When does UPI autopay launch?', 'Why did we choose Razorpay?', 'How fast do we refund a failed debit?', 'What caused the webhook outage?'];

const sourceLink = (s: AskSource) => (s.source === 'MEETING' && s.sessionId ? `/sessions/${s.sessionId}` : `/knowledge#${s.id}`);

export default function AskPage() {
  const [q, setQ] = useState('');
  const ask = useMutation({ mutationFn: (question: string) => api<AskResult>('/ask', { method: 'POST', body: { question } }) });
  const submit = (e?: FormEvent, text = q) => {
    e?.preventDefault();
    if (text.trim().length >= 3) ask.mutate(text.trim());
  };
  const r = ask.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Ask Relay</h1>
        <p className="text-sm text-slate-600">
          Ask anything the team has written down or decided. Answers come only from documents and past meetings <b>you are allowed to see</b>, and always cite them.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          aria-label="Your question"
          className={`${inputCls} !py-2.5 text-base`}
          placeholder="e.g. When does UPI autopay launch?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          autoFocus
        />
        <Button type="submit" variant="ai" busy={ask.isPending} className="!px-4">
          ✦ Ask
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => (setQ(ex), submit(undefined, ex))}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition hover:border-violet-400 hover:text-violet-800"
          >
            {ex}
          </button>
        ))}
      </div>

      <ErrorBox error={ask.error} />

      {r && (
        <Card className="animate-rise" title={r.answer ? '✦ Answer' : r.mode === 'search' ? 'Related documents' : 'No answer found'}>
          {r.answer ? (
            <>
              <p className="text-[15px] leading-relaxed text-slate-800">{r.answer}</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</p>
              <ul className="mt-1 space-y-1">
                {r.citations.map((c, i) => (
                  <li key={c.id} className="text-sm">
                    <span className="mr-1.5 rounded bg-violet-100 px-1.5 text-xs font-semibold text-violet-800">{i + 1}</span>
                    <Link className="text-teal-700 hover:underline" to={sourceLink(c)}>
                      {c.source === 'MEETING' ? '🗓️' : '📄'} {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                {r.mode === 'search'
                  ? 'AI is unavailable, so here are the closest documents you can see:'
                  : r.sources.length
                    ? "Nothing you can see answers this. These were the closest matches; Relay won't guess."
                    : "Nothing you can see mentions this. Relay won't guess."}
              </p>
              <ul className="mt-2 space-y-1">
                {r.sources.map((s) => (
                  <li key={s.id} className="text-sm">
                    <Link className="text-teal-700 hover:underline" to={sourceLink(s)}>
                      {s.source === 'MEETING' ? '🗓️' : '📄'} {s.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
