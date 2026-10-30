import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ActionItem, type ItemStatus, type Person } from '../api';
import { Avatar, Badge, Button, ErrorBox, fmtDate, inputCls, isOverdue, StatusBadge } from '../ui';

const STATUSES: ItemStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'DROPPED'];
const CLOSED = ['DONE', 'DROPPED'];

const eventText: Record<string, (from: string | null, to: string | null) => string> = {
  CREATED: () => 'Created',
  STATUS_CHANGED: (f, t) => `Status ${f?.toLowerCase()} → ${t?.toLowerCase()}`,
  REASSIGNED: (f, t) => `Reassigned ${f} → ${t}`,
  DUE_CHANGED: (f, t) => `Due date ${f ?? 'none'} → ${t ?? 'none'}`,
  CARRIED_FORWARD: (f, t) => `Carried forward: ${f} → ${t}`,
  OUTCOME_RECORDED: (_f, t) => `Outcome: ${t}`,
};

/** One action item with inline editing. Closing an item asks for its outcome first. */
export function ItemRow({ item, people, showSession }: { item: ActionItem; people: Person[]; showSession?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [closingAs, setClosingAs] = useState<ItemStatus | null>(null);
  const [outcome, setOutcome] = useState(item.outcome ?? '');
  const carried = item.events.filter((e) => e.type === 'CARRIED_FORWARD').length;
  const overdue = isOverdue(item.dueDate, item.status);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<ActionItem>(`/items/${item.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      setClosingAs(null);
      qc.invalidateQueries();
    },
  });
  const relink = useMutation({ mutationFn: () => api(`/items/${item.id}/link`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries() });

  const onStatus = (s: ItemStatus) => {
    if (CLOSED.includes(s) && !item.outcome) setClosingAs(s);
    else patch.mutate({ status: s });
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-[220px] flex-1 gap-2.5">
          {item.owner ? (
            <Avatar name={item.owner.name} />
          ) : (
            <span title="No owner" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-amber-400 text-xs font-semibold text-amber-600">
              ?
            </span>
          )}
          <div className="min-w-0">
          <p className={`text-sm font-medium ${CLOSED.includes(item.status) ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-900'}`}>{item.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <StatusBadge status={item.status} />
            {overdue && <Badge tone="bg-red-600 text-white ring-red-600">overdue</Badge>}
            {carried >= 2 && <Badge tone="bg-orange-50 text-orange-800 ring-orange-200" >carried {carried}×</Badge>}
            {!item.ownerId && <Badge tone="bg-amber-50 text-amber-800 ring-amber-200">no owner</Badge>}
            {showSession && (
              <Link to={`/sessions/${item.session.id}`} className="text-teal-700 hover:underline">
                {item.session.title}
              </Link>
            )}
            {item.links.length > 0 && <span>· {item.links.length} linked doc{item.links.length > 1 ? 's' : ''}</span>}
          </div>
          {item.outcome && <p className="mt-1 text-xs text-slate-600"><b>Outcome:</b> {item.outcome}</p>}
          </div>
        </div>
        <select aria-label="Owner" className={`${inputCls} !w-36`} value={item.ownerId ?? ''} onChange={(e) => patch.mutate({ ownerId: e.target.value || null })}>
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input
          aria-label="Due date"
          type="date"
          className={`${inputCls} !w-36 ${overdue ? 'border-red-400 text-red-700' : ''}`}
          value={item.dueDate?.slice(0, 10) ?? ''}
          onChange={(e) => patch.mutate({ dueDate: e.target.value || null })}
        />
        <select aria-label="Status" className={`${inputCls} !w-32`} value={closingAs ?? item.status} onChange={(e) => onStatus(e.target.value as ItemStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
        </select>
        <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide' : 'History'}</Button>
      </div>

      {closingAs && (
        <form
          className="mt-2 flex flex-wrap gap-2 rounded-md bg-slate-50 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ status: closingAs, outcome });
          }}
        >
          <input autoFocus required className={`${inputCls} flex-1`} placeholder={closingAs === 'DONE' ? 'What was the outcome?' : 'Why is it being dropped?'} value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={2000} />
          <Button type="submit" busy={patch.isPending}>Close as {closingAs.toLowerCase()}</Button>
          <Button type="button" variant="ghost" onClick={() => setClosingAs(null)}>Cancel</Button>
        </form>
      )}
      <div className="mt-2"><ErrorBox error={patch.error ?? relink.error} /></div>

      {open && (
        <div className="mt-2 grid gap-3 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
            <ol className="space-y-1 border-l border-slate-300 pl-3">
              {item.events.map((e) => (
                <li key={e.id}>
                  <span className="text-xs text-slate-500">{fmtDate(e.at)}</span> {eventText[e.type](e.fromValue, e.toValue)}
                  {e.note && <span className="text-slate-500"> ({e.note})</span>}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-slate-500">Raised in: {item.originSession.title}</p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Related knowledge</h3>
              <Button variant="ghost" className="!px-2 !py-0.5 text-xs" busy={relink.isPending} onClick={() => relink.mutate()}>Find with AI</Button>
            </div>
            {item.links.length === 0 && <p className="text-slate-500">No linked documents.</p>}
            <ul className="space-y-1.5">
              {item.links.map((l) => (
                <li key={l.id}>
                  <Link to={`/knowledge#${l.doc.id}`} className="font-medium text-teal-700 hover:underline">{l.doc.title}</Link>
                  <span className="block text-xs text-slate-600">{l.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

export function NewItemForm({ sessionId, people }: { sessionId: string; people: Person[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', ownerId: '', dueDate: '' });
  const add = useMutation({
    mutationFn: () => api(`/sessions/${sessionId}/items`, { method: 'POST', body: { title: f.title, ownerId: f.ownerId || null, dueDate: f.dueDate || null } }),
    onSuccess: () => {
      setF({ title: '', ownerId: '', dueDate: '' });
      qc.invalidateQueries();
    },
  });
  return (
    <form
      className="mt-3 space-y-2 border-t border-slate-100 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input aria-label="New item title" className={`${inputCls} min-w-[200px] flex-1`} placeholder="Add an action item…" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={300} />
        <select aria-label="New item owner" className={`${inputCls} !w-36`} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input aria-label="New item due date" type="date" className={`${inputCls} !w-36`} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        <Button type="submit" variant="secondary" busy={add.isPending}>Add</Button>
      </div>
      <ErrorBox error={add.error} />
    </form>
  );
}
