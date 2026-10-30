import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Conflict } from '../api';
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading, fmtDate } from '../ui';

export default function ConflictsPage() {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | 'DISMISSED'>('OPEN');
  const conflicts = useQuery({ queryKey: ['conflicts', status], queryFn: () => api<Conflict[]>(`/conflicts?status=${status}`) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Decision conflicts</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            When a new decision contradicts an earlier one, AI flags it here, so nobody keeps working from a decision that has quietly been reversed.
          </p>
        </div>
        <select aria-label="Status" className={`${inputCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </div>
      {conflicts.isLoading && <Loading />}
      <ErrorBox error={conflicts.error} />
      {conflicts.data?.length === 0 && <Empty>No {status.toLowerCase()} conflicts.</Empty>}
      {conflicts.data?.map((c) => <ConflictCard key={c.id} c={c} />)}
    </div>
  );
}

function ConflictCard({ c }: { c: Conflict }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(c.resolution ?? '');
  const act = useMutation({
    mutationFn: (status: Conflict['status']) => api(`/conflicts/${c.id}`, { method: 'PATCH', body: { status, resolution: note || undefined } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conflicts'] }),
  });
  const pct = Math.round(c.confidence * 100);
  const side = (label: string, d: Conflict['decision'], older: boolean) => (
    <div className={`rounded-md border p-3 ${older ? 'border-slate-200 bg-slate-50' : 'border-orange-300 bg-orange-50/50'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${older ? 'text-slate-500' : 'text-orange-700'}`}>{label}</p>
      <p className={`mt-1 text-sm ${older ? 'text-slate-500 line-through decoration-slate-300' : 'font-medium text-slate-900'}`}>{d.text}</p>
      <Link to={`/sessions/${d.session.id}`} className="mt-1 inline-block text-xs text-teal-700 hover:underline">
        {d.session.title} · {fmtDate(d.session.scheduledAt)}
      </Link>
    </div>
  );
  return (
    <Card
      className="animate-rise border-l-4 border-l-orange-500"
      title={<span className="flex items-center gap-2">⚠ Conflicting decisions</span>}
      actions={
        <span className="flex items-center gap-2 text-xs text-slate-600" title="How sure the AI is that these really contradict">
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
            <span className="block h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
          </span>
          <Badge>{pct}% confident</Badge>
        </span>
      }
    >
      <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        {side('Earlier decision', c.pastDecision, true)}
        <span aria-hidden className="text-center text-xl text-orange-500 sm:rotate-0">→</span>
        {side('Newer decision', c.decision, false)}
      </div>
      <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
        <b>✦ Why AI flagged it:</b> {c.explanation}
      </p>
      {c.status === 'OPEN' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input aria-label="Resolution note" className={`${inputCls} min-w-[220px] flex-1`} placeholder="Resolution, e.g. 'Newer decision stands; sprint plan updated'" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <Button busy={act.isPending} onClick={() => act.mutate('RESOLVED')}>Mark resolved</Button>
          <Button variant="secondary" busy={act.isPending} onClick={() => act.mutate('DISMISSED')}>Not a conflict</Button>
        </div>
      ) : (
        c.resolution && <p className="mt-2 text-sm text-slate-600"><b>Resolution:</b> {c.resolution}</p>
      )}
      <div className="mt-2"><ErrorBox error={act.error} /></div>
    </Card>
  );
}
