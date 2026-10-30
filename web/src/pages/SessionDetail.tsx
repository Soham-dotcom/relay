import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Attendance, type Brief, type Person, type RecapDraft, type SessionDetail, type SessionStatus, type SessionSummary } from '../api';
import { Badge, Button, Card, Empty, ErrorBox, fmtDate, inputCls, Loading, StatusBadge } from '../ui';
import { ItemRow, NewItemForm } from '../components/ItemRow';

export default function SessionPage() {
  const { id = '' } = useParams();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => api<SessionDetail>(`/sessions/${id}`) });
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') });

  if (session.isLoading) return <Loading />;
  if (session.error) return <ErrorBox error={session.error} />;
  const s = session.data!;
  const everyone = people.data ?? [];

  return (
    <div className="space-y-4">
      <Header s={s} />
      {s.kind === 'TRANSFER' && <TransferPanel s={s} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <RecapCard s={s} />
          <DecisionsCard s={s} />
          <Card title={`Action items (${s.items.length})`} actions={<CarryForward s={s} />}>
            {s.items.length === 0 && <Empty>No action items yet. Generate a recap or add one below.</Empty>}
            <ul className="divide-y divide-slate-100">
              {s.items.map((it) => <ItemRow key={it.id} item={it} people={everyone} />)}
            </ul>
            <NewItemForm sessionId={s.id} people={everyone} />
          </Card>
        </div>
        <div className="space-y-4">
          <BriefCard s={s} />
          <ParticipantsCard s={s} />
          {s.agenda && (
            <Card title="Agenda">
              <p className="whitespace-pre-line text-sm text-slate-700">{s.agenda}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ s }: { s: SessionDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const update = useMutation({ mutationFn: (status: SessionStatus) => api(`/sessions/${s.id}`, { method: 'PATCH', body: { status } }), onSuccess: () => qc.invalidateQueries() });
  const del = useMutation({
    mutationFn: () => api(`/sessions/${s.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries();
      navigate('/');
    },
  });
  return (
    <div className="space-y-2">
      <Link to="/" className="text-sm text-teal-700 hover:underline">← All sessions</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={s.kind === 'TRANSFER' ? 'bg-violet-50 text-violet-700 ring-violet-200' : undefined}>{s.kind === 'TRANSFER' ? 'Work transfer' : 'Meeting'}</Badge>
            <StatusBadge status={s.status} />
            <span className="text-sm text-slate-500">{fmtDate(s.scheduledAt)}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{s.title}</h1>
          <p className="text-sm text-slate-500">
            {s.previous && <>Follows <Link className="text-teal-700 hover:underline" to={`/sessions/${s.previous.id}`}>{s.previous.title}</Link>. </>}
            {s.next.map((n) => <span key={n.id}>Continued in <Link className="text-teal-700 hover:underline" to={`/sessions/${n.id}`}>{n.title}</Link>. </span>)}
          </p>
        </div>
        <div className="flex gap-2">
          <select aria-label="Session status" className={`${inputCls} !w-auto`} value={s.status} onChange={(e) => update.mutate(e.target.value as SessionStatus)}>
            <option value="PLANNED">Planned</option>
            <option value="HELD">Held</option>
            <option value="CLOSED">Closed</option>
          </select>
          <Button variant="danger" busy={del.isPending} onClick={() => confirm('Delete this session and its items?') && del.mutate()}>Delete</Button>
        </div>
      </div>
      <ErrorBox error={update.error ?? del.error} />
    </div>
  );
}

function TransferPanel({ s }: { s: SessionDetail }) {
  const qc = useQueryClient();
  const hand = useMutation({ mutationFn: () => api<{ reassigned: number }>(`/sessions/${s.id}/transfer-items`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries() });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm">
      <span>
        <b>{s.fromPerson?.name}</b> is handing over to <b>{s.toPerson?.name}</b>.
      </span>
      <Button variant="secondary" busy={hand.isPending} onClick={() => hand.mutate()} className="ml-auto">
        Reassign all of {s.fromPerson?.name.split(' ')[0]}'s open items to {s.toPerson?.name.split(' ')[0]}
      </Button>
      {hand.data && <span className="w-full text-violet-800">{hand.data.reassigned} item(s) reassigned. Each item's history records the hand-over.</span>}
      <div className="w-full"><ErrorBox error={hand.error} /></div>
    </div>
  );
}

function RecapCard({ s }: { s: SessionDetail }) {
  const qc = useQueryClient();
  const people = s.participants.map((p) => p.person);
  const [raw, setRaw] = useState(s.notes);
  const [draft, setDraft] = useState<RecapDraft | null>(null);
  const [editing, setEditing] = useState(!s.summary);

  const gen = useMutation({ mutationFn: () => api<RecapDraft>(`/sessions/${s.id}/recap/draft`, { method: 'POST', body: { raw } }), onSuccess: setDraft });
  const save = useMutation({
    mutationFn: (d: RecapDraft) =>
      api<{ decisions: number; items: number; updated: number; links: number; conflicts: number; warnings: string[] }>(`/sessions/${s.id}/recap/apply`, {
        method: 'POST',
        body: {
          summary: d.summary,
          notes: raw,
          decisions: d.decisions.filter((x) => x.trim()),
          actionItems: d.actionItems
            .filter((a) => a.title.trim())
            .map((a) => ({ title: a.title, ownerId: a.ownerId, dueDate: a.dueDate, existingItemId: a.existingItemId })),
        },
      }),
    onSuccess: () => {
      setDraft(null);
      setEditing(false);
      qc.invalidateQueries();
    },
  });
  const upd = (fn: (d: RecapDraft) => void) => setDraft((d) => (d ? fnApply(d, fn) : d));

  return (
    <Card
      title="Summary & AI recap"
      actions={!editing && <Button variant="ghost" onClick={() => setEditing(true)}>Add more notes</Button>}
    >
      {s.summary && <p className="text-sm leading-relaxed text-slate-700">{s.summary}</p>}
      {save.data && (
        <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Saved {save.data.decisions} decisions and {save.data.items} new items
          {save.data.updated > 0 && <>, updated {save.data.updated} existing</>} · {save.data.links} knowledge links · {save.data.conflicts} conflict(s) found.
          {save.data.warnings.map((w) => <p key={w} className="text-amber-800">⚠ {w}</p>)}
        </div>
      )}

      {editing && !draft && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="raw">Raw notes, chat, email or transcript</label>
          <textarea id="raw" className={`${inputCls} font-mono text-xs`} rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} maxLength={30000}
            placeholder="Paste anything: meeting notes, a Slack thread, an email chain, a transcript…" />
          <div className="flex items-center gap-2">
            <Button variant="ai" busy={gen.isPending} disabled={raw.trim().length < 20} onClick={() => gen.mutate()}>✦ Generate recap with AI</Button>
            <span className="text-xs text-slate-500">You review and edit before anything is saved.</span>
          </div>
          <ErrorBox error={gen.error} />
          {gen.error && (
            <Button variant="secondary" onClick={() => setDraft({ summary: '', decisions: [''], actionItems: [] })}>Write the recap by hand</Button>
          )}
        </div>
      )}

      {draft && (
        <div className="mt-3 space-y-4 rounded-md border border-violet-200 bg-violet-50/40 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-violet-700">Draft: review before saving</p>
          <div>
            <label className="text-sm font-medium" htmlFor="sum">Summary</label>
            <textarea id="sum" className={inputCls} rows={3} value={draft.summary} onChange={(e) => upd((d) => void (d.summary = e.target.value))} />
          </div>
          <div>
            <p className="text-sm font-medium">Decisions</p>
            {draft.decisions.map((dec, i) => (
              <div key={i} className="mt-1 flex gap-2">
                <input aria-label={`Decision ${i + 1}`} className={inputCls} value={dec} onChange={(e) => upd((d) => void (d.decisions[i] = e.target.value))} />
                <Button variant="ghost" aria-label="Remove decision" onClick={() => upd((d) => void d.decisions.splice(i, 1))}>✕</Button>
              </div>
            ))}
            <Button variant="ghost" className="mt-1" onClick={() => upd((d) => void d.decisions.push(''))}>+ Decision</Button>
          </div>
          <div>
            <p className="text-sm font-medium">Action items</p>
            {draft.actionItems.map((a, i) => (
              <div key={i} className="mt-2 rounded border border-slate-200 bg-white p-2">
                {a.existingItemId && (
                  <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-sky-800">
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium ring-1 ring-sky-200">Already open: will update owner/due date, not duplicate</span>
                    <button type="button" className="underline" onClick={() => upd((d) => void (d.actionItems[i].existingItemId = null))}>Make it a new item instead</button>
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <input aria-label={`Item ${i + 1} title`} disabled={Boolean(a.existingItemId)} className={`${inputCls} min-w-[180px] flex-1 disabled:bg-slate-50`} value={a.title} onChange={(e) => upd((d) => void (d.actionItems[i].title = e.target.value))} />
                  <select aria-label={`Item ${i + 1} owner`} className={`${inputCls} !w-36`} value={a.ownerId ?? ''} onChange={(e) => upd((d) => void (d.actionItems[i].ownerId = e.target.value || null))}>
                    <option value="">Unassigned</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input aria-label={`Item ${i + 1} due`} type="date" className={`${inputCls} !w-36`} value={a.dueDate ?? ''} onChange={(e) => upd((d) => void (d.actionItems[i].dueDate = e.target.value || null))} />
                  <Button variant="ghost" aria-label="Remove item" onClick={() => upd((d) => void d.actionItems.splice(i, 1))}>✕</Button>
                </div>
                {a.suggestedOwner && !a.ownerId && <p className="mt-1 text-xs text-amber-700">AI named "{a.suggestedOwner}", who is not a participant. Pick an owner.</p>}
                {a.evidence && <p className="mt-1 text-xs italic text-slate-500">“{a.evidence}”</p>}
              </div>
            ))}
            <Button variant="ghost" className="mt-1" onClick={() => upd((d) => void d.actionItems.push({ title: '', ownerId: null, suggestedOwner: null, dueDate: null, evidence: null, existingItemId: null }))}>+ Item</Button>
          </div>
          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <Button busy={save.isPending} disabled={!draft.summary.trim()} onClick={() => save.mutate(draft)}>Save recap</Button>
            <Button variant="secondary" onClick={() => setDraft(null)}>Discard</Button>
          </div>
          {save.isPending && <p className="text-xs text-slate-500">Saving, linking to the knowledge base and checking for conflicting decisions…</p>}
        </div>
      )}
    </Card>
  );
}

function fnApply(d: RecapDraft, fn: (d: RecapDraft) => void) {
  const copy = structuredClone(d);
  fn(copy);
  return copy;
}

function DecisionsCard({ s }: { s: SessionDetail }) {
  if (s.decisions.length === 0) return null;
  return (
    <Card title={`Decisions (${s.decisions.length})`}>
      <ul className="space-y-3">
        {s.decisions.map((d) => (
          <li key={d.id} className="text-sm">
            <p className="text-slate-900">• {d.text}</p>
            {d.conflicts?.filter((c) => c.status === 'OPEN').map((c) => (
              <div key={c.id} className="mt-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">
                <b>⚠ Conflicts with an earlier decision</b> from{' '}
                <Link className="underline" to={`/sessions/${c.pastDecision.session.id}`}>{c.pastDecision.session.title} ({fmtDate(c.pastDecision.session.scheduledAt)})</Link>: “{c.pastDecision.text}”
                <p className="mt-1">{c.explanation}</p>
                <Link to="/conflicts" className="mt-1 inline-block font-medium underline">Resolve →</Link>
              </div>
            ))}
            {d.links?.map((l) => (
              <p key={l.id} className="mt-1 text-xs text-slate-600">
                📄 <Link className="font-medium text-teal-700 hover:underline" to={`/knowledge#${l.doc.id}`}>{l.doc.title}</Link>: {l.reason}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CarryForward({ s }: { s: SessionDetail }) {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions', ''], queryFn: () => api<SessionSummary[]>('/sessions') });
  const [to, setTo] = useState('');
  const open = s.items.filter((i) => ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(i.status)).length;
  const carry = useMutation({ mutationFn: () => api<{ moved: number }>(`/sessions/${s.id}/carry-forward`, { method: 'POST', body: { toSessionId: to } }), onSuccess: () => qc.invalidateQueries() });
  if (open === 0) return null;
  const targets = (sessions.data ?? []).filter((x) => x.id !== s.id && x.status !== 'CLOSED');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Carry forward to" className={`${inputCls} !w-52`} value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Carry {open} open item(s) to…</option>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.title} ({fmtDate(t.scheduledAt)})</option>)}
      </select>
      <Button variant="secondary" disabled={!to} busy={carry.isPending} onClick={() => carry.mutate()}>Carry forward</Button>
      {carry.error && <span className="text-xs text-red-700">{(carry.error as Error).message}</span>}
    </div>
  );
}

function ParticipantsCard({ s }: { s: SessionDetail }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: ({ personId, attendance }: { personId: string; attendance: Attendance }) => api(`/sessions/${s.id}/participants/${personId}`, { method: 'PUT', body: { attendance } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', s.id] }),
  });
  return (
    <Card title="Participants">
      {s.participants.length === 0 && <Empty>No participants.</Empty>}
      <ul className="space-y-2">
        {s.participants.map((p) => (
          <li key={p.personId} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {p.person.name}
              <span className="block text-xs text-slate-500">{p.person.role}</span>
            </span>
            <select aria-label={`${p.person.name} attendance`} className={`${inputCls} !w-28 ${p.attendance === 'MISSED' ? 'text-red-700' : ''}`} value={p.attendance} onChange={(e) => set.mutate({ personId: p.personId, attendance: e.target.value as Attendance })}>
              <option value="INVITED">Invited</option>
              <option value="ATTENDED">Attended</option>
              <option value="MISSED">Missed</option>
            </select>
          </li>
        ))}
      </ul>
      <ErrorBox error={set.error} />
    </Card>
  );
}

function BriefCard({ s }: { s: SessionDetail }) {
  const defaultReader = s.kind === 'TRANSFER' ? s.toPerson?.id : s.participants.find((p) => p.attendance === 'MISSED')?.personId;
  const [reader, setReader] = useState(defaultReader ?? '');
  const brief = useMutation({ mutationFn: () => api<Brief>(`/sessions/${s.id}/brief`, { method: 'POST', body: reader ? { readerId: reader } : {} }) });
  const b = brief.data?.brief;
  return (
    <Card title="Catch-up brief">
      <p className="mb-2 text-xs text-slate-600">{s.kind === 'TRANSFER' ? 'For the person taking over.' : 'For anyone who missed it.'} Personalised to the reader's own items.</p>
      <div className="flex gap-2">
        <select aria-label="Brief for" className={inputCls} value={reader} onChange={(e) => setReader(e.target.value)}>
          <option value="">Anyone (general)</option>
          {s.participants.map((p) => <option key={p.personId} value={p.personId}>{p.person.name}{p.attendance === 'MISSED' ? ' (missed)' : ''}</option>)}
        </select>
        <Button variant="ai" busy={brief.isPending} onClick={() => brief.mutate()}>✦ Brief</Button>
      </div>
      <div className="mt-2"><ErrorBox error={brief.error} /></div>
      {b && (
        <div className="mt-3 space-y-3 text-sm">
          {brief.data?.source === 'fallback' && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">AI unavailable: this brief was built directly from the saved data.</p>}
          <p className="font-medium text-slate-900">{b.headline}</p>
          <p className="text-slate-700">{b.summary}</p>
          <BriefList title="Your actions" items={b.yourActions} tone="text-teal-800" />
          <BriefList title="Key decisions" items={b.keyDecisions} />
          <BriefList title="Other open items" items={b.openItems} />
          <BriefList title="Watch out" items={b.watchOut} tone="text-red-800" />
        </div>
      )}
    </Card>
  );
}

function BriefList({ title, items, tone = 'text-slate-700' }: { title: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className={`mt-1 list-disc space-y-0.5 pl-5 ${tone}`}>{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}
