import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ActionItem, type Person } from '../api';
import { Card, Empty, ErrorBox, inputCls, isOverdue, Loading, Stat } from '../ui';
import { ItemRow } from '../components/ItemRow';

export default function ItemsPage() {
  const [filter, setFilter] = useState({ view: 'open', ownerId: '' });
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') });
  const qs = new URLSearchParams();
  if (filter.view === 'open' || filter.view === 'slipping') qs.set('open', 'true');
  if (filter.view === 'overdue') qs.set('overdue', 'true');
  if (filter.view === 'DONE' || filter.view === 'DROPPED') qs.set('status', filter.view);
  if (filter.ownerId) qs.set('ownerId', filter.ownerId);
  const items = useQuery({ queryKey: ['items', filter], queryFn: () => api<ActionItem[]>(`/items?${qs}`) });
  const all = useQuery({ queryKey: ['items', 'stats'], queryFn: () => api<ActionItem[]>('/items?open=true') });
  const slipping = (i: ActionItem) => i.events.filter((e) => e.type === 'CARRIED_FORWARD').length >= 2;
  const shown = filter.view === 'slipping' ? items.data?.filter(slipping) : items.data;

  const stats = all.data && {
    open: all.data.length,
    overdue: all.data.filter((i) => isOverdue(i.dueDate, i.status)).length,
    slipping: all.data.filter(slipping).length,
    unassigned: all.data.filter((i) => !i.ownerId).length,
  };
  // Each counter is also a one-click filter for the list below.
  const tiles = stats && [
    { label: 'Open', n: stats.open, tone: 'text-slate-900', set: { view: 'open', ownerId: '' } },
    { label: 'Overdue', n: stats.overdue, tone: 'text-red-700', set: { view: 'overdue', ownerId: '' } },
    { label: 'Carried 2+ times', n: stats.slipping, tone: 'text-orange-700', set: { view: 'slipping', ownerId: '' } },
    { label: 'No owner', n: stats.unassigned, tone: 'text-amber-700', set: { view: 'open', ownerId: 'none' } },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Action items</h1>
        <p className="text-sm text-slate-600">Every item across all meetings and transfers, followed until it is closed with an outcome. Click a counter to filter.</p>
      </div>
      {tiles && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => {
            const active = filter.view === t.set.view && filter.ownerId === t.set.ownerId;
            return (
              <button
                key={t.label}
                onClick={() => setFilter(t.set)}
                aria-pressed={active}
                className={`rounded-lg text-left transition hover:-translate-y-0.5 hover:shadow-md ${active ? 'ring-2 ring-teal-600' : ''}`}
              >
                <Stat label={t.label} value={t.n} tone={t.tone} />
              </button>
            );
          })}
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
              <option value="slipping">Carried 2+ times</option>
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
        {shown?.length === 0 && <Empty>Nothing here. Nice.</Empty>}
        <ul className="divide-y divide-slate-100">
          {shown?.map((it) => <ItemRow key={it.id} item={it} people={people.data ?? []} showSession />)}
        </ul>
      </Card>
    </div>
  );
}
