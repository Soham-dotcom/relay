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
        <select aria-label="Status" className={`${inputCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
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
  const side = (label: string, d: Conflict['decision']) => (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-900">{d.text}</p>
      <Link to={`/sessions/${d.session.id}`} className="mt-1 inline-block text-xs text-teal-700 hover:underline">
        {d.session.title} · {fmtDate(d.session.scheduledAt)}
      </Link>
    </div>
  );
  return (
    <Card title={<span className="flex items-center gap-2">⚠ Conflicting decisions <Badge>{Math.round(c.confidence * 100)}% confident</Badge></span>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {side('Earlier decision', c.pastDecision)}
        {side('Newer decision', c.decision)}
      </div>
      <p className="mt-3 text-sm text-slate-700"><b>Why AI flagged it:</b> {c.explanation}</p>
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
