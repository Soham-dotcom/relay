import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ActionItem, type Conflict, type MissedSession, type Person, type SessionKind, type SessionSummary, type Visibility } from '../api';
import {
  AvatarStack,
  Badge,
  Button,
  Empty,
  ErrorBox,
  Field,
  inputCls,
  isOverdue,
  Loading,
  Modal,
  Stat,
  StatusBadge,
  VisibilityBadge,
  VisibilityPicker,
  fmtDate,
} from '../ui';
import { useMe } from '../App';

export default function SessionsPage() {
  const [kind, setKind] = useState<'' | SessionKind>('');
  const [creating, setCreating] = useState(false);
  const me = useMe().data;
  const sessions = useQuery({ queryKey: ['sessions', kind], queryFn: () => api<SessionSummary[]>(`/sessions${kind ? `?kind=${kind}` : ''}`) });
  const open = useQuery({ queryKey: ['items', 'stats'], queryFn: () => api<ActionItem[]>('/items?open=true') });
  const conflicts = useQuery({ queryKey: ['conflicts', 'OPEN'], queryFn: () => api<Conflict[]>('/conflicts?status=OPEN') });
  const mine = open.data?.filter((i) => i.ownerId === me?.id) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Hi {me?.name.split(' ')[0]} 👋</p>
          <h1 className="text-xl font-semibold text-slate-900">Meetings & work transfers</h1>
          <p className="text-sm text-slate-600">Everything discussed, decided and handed over, with every open item followed until it closes.</p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Filter by kind" className={`${inputCls} !w-auto`} value={kind} onChange={(e) => setKind(e.target.value as SessionKind | '')}>
            <option value="">All</option>
            <option value="MEETING">Meetings</option>
            <option value="TRANSFER">Work transfers</option>
          </select>
          <Button onClick={() => setCreating(true)}>+ New</Button>
        </div>
      </div>

      {open.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link to="/items" className="rounded-lg transition hover:shadow-sm">
            <Stat label="My open items" value={mine.length} tone="text-teal-700" hint="Open items you own" />
          </Link>
          <Link to="/items" className="rounded-lg transition hover:shadow-sm">
            <Stat label="Open items you can see" value={open.data.length} />
          </Link>
          <Link to="/items" className="rounded-lg transition hover:shadow-sm">
            <Stat label="Overdue" value={open.data.filter((i) => isOverdue(i.dueDate, i.status)).length} tone="text-red-700" />
          </Link>
          <Link to="/conflicts" className="rounded-lg transition hover:shadow-sm">
            <Stat label="Decision conflicts" value={conflicts.data?.length ?? 0} tone="text-orange-700" hint="Open conflicts between decisions" />
          </Link>
        </div>
      )}

      <MissedPanel />

      {sessions.isLoading && <Loading />}
      <ErrorBox error={sessions.error} />
      {sessions.data?.length === 0 && <Empty>No sessions yet. Create the first meeting or work transfer.</Empty>}

      <ul className="grid gap-3 md:grid-cols-2">
        {sessions.data?.map((s, i) => (
          <li key={s.id} className="animate-rise" style={{ animationDelay: `${i * 30}ms` }}>
            <Link
              to={`/sessions/${s.id}`}
              className={`group flex h-full flex-col rounded-lg border border-l-4 border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md ${
                s.kind === 'TRANSFER' ? 'border-l-violet-500' : s.status === 'PLANNED' ? 'border-l-sky-500' : 'border-l-teal-600'
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={s.kind === 'TRANSFER' ? 'bg-violet-50 text-violet-700 ring-violet-200' : undefined}>{s.kind === 'TRANSFER' ? 'Work transfer' : 'Meeting'}</Badge>
                <StatusBadge status={s.status} />
                <VisibilityBadge visibility={s.visibility} team={s.team} />
                <span className="ml-auto text-xs text-slate-500">{fmtDate(s.scheduledAt)}</span>
              </div>
              <h2 className="mt-2 font-medium text-slate-900 group-hover:text-teal-800">{s.title}</h2>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-slate-600">
                <AvatarStack names={s.participants.map((p) => p.person.name)} />
                <span>
                  {s._count.decisions} decisions · {s._count.items} items
                  {s.openItems > 0 && <b className="ml-1 text-amber-700">· {s.openItems} open</b>}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {creating && <NewSessionModal sessions={sessions.data ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Meetings I missed and hand-overs coming to me: each opens straight into my catch-up brief. */
function MissedPanel() {
  const missed = useQuery({ queryKey: ['missed'], queryFn: () => api<MissedSession[]>('/me/missed') });
  if (!missed.data?.length) return null;
  return (
    <section className="animate-rise rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-violet-900">✦ Catch up: {missed.data.length} thing{missed.data.length > 1 ? 's' : ''} you missed</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {missed.data.map((m) => (
          <li key={m.id}>
            <Link
              to={`/sessions/${m.id}#brief`}
              className="flex items-center justify-between gap-3 rounded-md border border-violet-100 bg-white px-3 py-2 text-sm transition hover:border-violet-400 hover:shadow-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{m.title}</span>
                <span className="block text-xs text-slate-500">
                  {m.reason === 'handover' ? 'Being handed to you' : 'You missed it'} · {fmtDate(m.scheduledAt)} · {m.decisions} decisions
                  {m.yourItems > 0 && <b className="text-teal-700"> · {m.yourItems} yours</b>}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white">Brief me</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewSessionModal({ sessions, onClose }: { sessions: SessionSummary[]; onClose: () => void }) {
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') });
  const me = useMe().data;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const withOpen = sessions.filter((s) => s.openItems > 0);
  const [f, setF] = useState({
    kind: 'MEETING' as SessionKind,
    title: '',
    scheduledAt: new Date().toISOString().slice(0, 10),
    visibility: 'TEAM' as Visibility,
    teamId: me?.teams[0]?.id ?? '',
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
          teamId: f.visibility === 'ORG' ? null : f.teamId || null,
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
        <Field label="Who can see it" hint="Fixed once created. The AI brief, links and conflict checks follow the same rule.">
          <VisibilityPicker value={f.visibility} onChange={(v) => set('visibility', v)} privateHint="Only the participants (you are added)" />
        </Field>
        {f.visibility !== 'ORG' && (me?.teams.length ?? 0) > 1 && (
          <Field label="Team">
            <select className={inputCls} value={f.teamId} onChange={(e) => set('teamId', e.target.value)}>
              {me?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
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
