import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ActionItem, type Person } from '../api';
import { Card, Empty, ErrorBox, inputCls, isOverdue, Loading } from '../ui';
import { ItemRow } from '../components/ItemRow';

export default function ItemsPage() {
  const [filter, setFilter] = useState({ view: 'open', ownerId: '' });
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') });
  const qs = new URLSearchParams();
  if (filter.view === 'open') qs.set('open', 'true');
  if (filter.view === 'overdue') qs.set('overdue', 'true');
  if (filter.view === 'DONE' || filter.view === 'DROPPED') qs.set('status', filter.view);
  if (filter.ownerId) qs.set('ownerId', filter.ownerId);
  const items = useQuery({ queryKey: ['items', filter], queryFn: () => api<ActionItem[]>(`/items?${qs}`) });
  const all = useQuery({ queryKey: ['items', 'stats'], queryFn: () => api<ActionItem[]>('/items?open=true') });

  const stats = all.data && {
    open: all.data.length,
    overdue: all.data.filter((i) => isOverdue(i.dueDate, i.status)).length,
    slipping: all.data.filter((i) => i.events.filter((e) => e.type === 'CARRIED_FORWARD').length >= 2).length,
    unassigned: all.data.filter((i) => !i.ownerId).length,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Action items</h1>
        <p className="text-sm text-slate-600">Every item across all meetings and transfers, followed until it is closed with an outcome.</p>
      </div>
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Open', stats.open, 'text-slate-900'],
            ['Overdue', stats.overdue, 'text-red-700'],
            ['Carried 2+ times', stats.slipping, 'text-orange-700'],
            ['No owner', stats.unassigned, 'text-amber-700'],
          ].map(([label, n, tone]) => (
            <div key={label as string} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{n}</p>
            </div>
          ))}
        </div>
      )}
      <Card
        title="Items"
        actions={
          <>
            <select aria-label="Show" className={`${inputCls} !w-auto`} value={filter.view} onChange={(e) => setFilter({ ...filter, view: e.target.value })}>
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
              <option value="DONE">Done</option>
              <option value="DROPPED">Dropped</option>
              <option value="all">All</option>
            </select>
            <select aria-label="Owner" className={`${inputCls} !w-auto`} value={filter.ownerId} onChange={(e) => setFilter({ ...filter, ownerId: e.target.value })}>
              <option value="">Any owner</option>
              <option value="none">Unassigned</option>
              {people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        }
      >
        {items.isLoading && <Loading />}
        <ErrorBox error={items.error} />
        {items.data?.length === 0 && <Empty>Nothing here.</Empty>}
        <ul className="divide-y divide-slate-100">
          {items.data?.map((it) => <ItemRow key={it.id} item={it} people={people.data ?? []} showSession />)}
        </ul>
      </Card>
    </div>
  );
}
