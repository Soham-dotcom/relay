import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type ActivityRequest } from '../api';
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading } from '../ui';

const levelTone = (l: number) => (l >= 50 ? 'bg-red-50 text-red-800 ring-red-200' : l >= 40 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-100 text-slate-700 ring-slate-200');
const statusTone = (s: number | null) => (!s ? undefined : s >= 500 ? 'bg-red-600 text-white ring-red-600' : s >= 400 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200');
const time = (t: string) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** My recent requests, from the server's structured log. Paste a request ID from any error to see its whole trail. */
export default function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const rid = params.get('rid') ?? '';
  const [input, setInput] = useState(rid);
  const activity = useQuery({
    queryKey: ['activity', rid],
    queryFn: () => api<{ available: boolean; requests: ActivityRequest[] }>(`/me/activity${rid ? `?requestId=${encodeURIComponent(rid)}` : ''}`),
  });
  const search = (e: FormEvent) => {
    e.preventDefault();
    setParams(input.trim() ? { rid: input.trim() } : {});
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">My activity</h1>
        <p className="text-sm text-slate-600">
          Your recent requests as the server logged them: what happened, AI calls with their latency, and warnings. Only your own requests are shown. Paste a request ID
          from any error message to see exactly what happened.
        </p>
      </div>
      <form onSubmit={search} className="flex gap-2">
        <input aria-label="Request ID" className={`${inputCls} font-mono text-xs`} placeholder="Request ID, e.g. 8b62fec5-…" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" variant="secondary">Find</Button>
        {rid && (
          <Button type="button" variant="ghost" onClick={() => (setInput(''), setParams({}))}>
            Show all
          </Button>
        )}
      </form>

      {activity.isLoading && <Loading />}
      <ErrorBox error={activity.error} />
      {activity.data && !activity.data.available && <Empty>The log file is not available on this server yet.</Empty>}
      {activity.data?.available && activity.data.requests.length === 0 && <Empty>{rid ? 'No request of yours with that ID.' : 'No activity yet.'}</Empty>}

      <div className="space-y-2">
        {activity.data?.requests.map((r) => (
          <Card key={r.requestId} className="animate-rise">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-slate-500">{time(r.time)}</span>
              {r.method && <b className="font-mono text-xs">{r.method}</b>}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{r.url}</span>
              {r.status && <Badge tone={statusTone(r.status)}>{r.status}</Badge>}
              {r.durationMs != null && <span className="text-xs tabular-nums text-slate-500">{r.durationMs} ms</span>}
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-400">{r.requestId}</p>
            {r.events.length > 0 && (
              <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
                {r.events.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={levelTone(e.level)}>{e.event ?? (e.level >= 40 ? 'warn' : 'info')}</Badge>
                    <span className="text-slate-700">{e.msg}</span>
                    {e.op && <span className="font-mono text-slate-500">{e.op}</span>}
                    {e.latencyMs != null && <span className="tabular-nums text-violet-700">{e.latencyMs} ms</span>}
                    {e.outcome && <span className={e.outcome === 'ok' ? 'text-emerald-700' : 'text-red-700'}>{e.outcome}</span>}
                    {e.attempt && e.attempt > 1 && <span className="text-amber-700">attempt {e.attempt}</span>}
                    {e.code && <span className="font-mono text-slate-500">{e.code}</span>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
