import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Person, type SessionKind, type SessionSummary } from '../api';
import { Badge, Button, Empty, ErrorBox, Field, inputCls, Loading, Modal, StatusBadge, fmtDate } from '../ui';

export default function SessionsPage() {
  const [kind, setKind] = useState<'' | SessionKind>('');
  const [creating, setCreating] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions', kind], queryFn: () => api<SessionSummary[]>(`/sessions${kind ? `?kind=${kind}` : ''}`) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Meetings & work transfers</h1>
          <p className="text-sm text-slate-600">Everything discussed, decided and handed over, with every open item followed until it closes.</p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Filter by kind" className={`${inputCls} w-auto`} value={kind} onChange={(e) => setKind(e.target.value as SessionKind | '')}>
            <option value="">All</option>
            <option value="MEETING">Meetings</option>
            <option value="TRANSFER">Work transfers</option>
          </select>
          <Button onClick={() => setCreating(true)}>+ New</Button>
        </div>
      </div>

      {sessions.isLoading && <Loading />}
      <ErrorBox error={sessions.error} />
      {sessions.data?.length === 0 && <Empty>No sessions yet. Create the first meeting or work transfer.</Empty>}

      <ul className="grid gap-3">
        {sessions.data?.map((s) => (
          <li key={s.id}>
            <Link to={`/sessions/${s.id}`} className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal-400 hover:shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={s.kind === 'TRANSFER' ? 'bg-violet-50 text-violet-700 ring-violet-200' : undefined}>{s.kind === 'TRANSFER' ? 'Work transfer' : 'Meeting'}</Badge>
                <StatusBadge status={s.status} />
                <span className="text-sm text-slate-500">{fmtDate(s.scheduledAt)}</span>
              </div>
              <h2 className="mt-1.5 font-medium text-slate-900">{s.title}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {s.participants.map((p) => p.person.name.split(' ')[0]).join(', ') || 'No participants'} · {s._count.decisions} decisions · {s._count.items} items
                {s.openItems > 0 && <b className="ml-1 text-amber-700">· {s.openItems} open</b>}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {creating && <NewSessionModal sessions={sessions.data ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewSessionModal({ sessions, onClose }: { sessions: SessionSummary[]; onClose: () => void }) {
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const withOpen = sessions.filter((s) => s.openItems > 0);
  const [f, setF] = useState({
    kind: 'MEETING' as SessionKind,
    title: '',
    scheduledAt: new Date().toISOString().slice(0, 10),
    agenda: '',
    participantIds: [] as string[],
    fromPersonId: '',
    toPersonId: '',
    carryFromId: withOpen[0]?.id ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/sessions', {
        method: 'POST',
        body: {
          ...f,
          fromPersonId: f.kind === 'TRANSFER' ? f.fromPersonId || null : null,
          toPersonId: f.kind === 'TRANSFER' ? f.toPersonId || null : null,
          carryFromId: f.carryFromId || null,
        },
      }),
    onSuccess: (s) => {
      qc.invalidateQueries();
      navigate(`/sessions/${s.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Modal title="New meeting or work transfer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-2" role="radiogroup" aria-label="Kind">
          {(['MEETING', 'TRANSFER'] as const).map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={f.kind === k}
              onClick={() => set('kind', k)}
              className={`flex-1 rounded-md border px-3 py-2 text-left text-sm ${f.kind === k ? 'border-teal-600 bg-teal-50' : 'border-slate-200'}`}
            >
              <b>{k === 'MEETING' ? 'Meeting' : 'Work transfer'}</b>
              <span className="block text-xs text-slate-600">{k === 'MEETING' ? 'Agenda, notes, decisions, items' : 'Someone hands work to a colleague'}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Title">
            <input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} placeholder={f.kind === 'MEETING' ? 'Payments weekly sync' : 'Rahul on leave: webhook work to Priya'} />
          </Field>
          <Field label="Date">
            <input type="date" className={inputCls} value={f.scheduledAt} onChange={(e) => set('scheduledAt', e.target.value)} required />
          </Field>
        </div>
        {f.kind === 'TRANSFER' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Handing over (from)">
              <select className={inputCls} value={f.fromPersonId} onChange={(e) => set('fromPersonId', e.target.value)} required>
                <option value="">Choose…</option>
                {people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Taking over (to)">
              <select className={inputCls} value={f.toPersonId} onChange={(e) => set('toPersonId', e.target.value)} required>
                <option value="">Choose…</option>
                {people.data?.filter((p) => p.id !== f.fromPersonId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        <Field label="Participants">
          <div className="flex flex-wrap gap-2">
            {people.data?.map((p) => {
              const on = f.participantIds.includes(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={on}
                  onClick={() => set('participantIds', on ? f.participantIds.filter((x) => x !== p.id) : [...f.participantIds, p.id])}
                  className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-300 text-slate-600'}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Agenda">
          <textarea className={inputCls} rows={3} value={f.agenda} onChange={(e) => set('agenda', e.target.value)} maxLength={5000} />
        </Field>
        <Field label="Carry forward open items from" hint="Open items move here with their full history, so nothing from last time is forgotten.">
          <select className={inputCls} value={f.carryFromId} onChange={(e) => set('carryFromId', e.target.value)}>
            <option value="">Don't carry anything</option>
            {withOpen.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({fmtDate(s.scheduledAt)}) · {s.openItems} open
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={create.isPending}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}
