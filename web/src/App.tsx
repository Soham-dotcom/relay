import { NavLink, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Conflict } from './api';
import SessionsPage from './pages/Sessions';
import SessionPage from './pages/SessionDetail';
import ItemsPage from './pages/Items';
import KnowledgePage from './pages/Knowledge';
import ConflictsPage from './pages/Conflicts';

export default function App() {
  const conflicts = useQuery({ queryKey: ['conflicts', 'OPEN'], queryFn: () => api<Conflict[]>('/conflicts?status=OPEN') });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ ai: string }>('/health') });

  const nav = [
    { to: '/', label: 'Sessions', end: true },
    { to: '/items', label: 'Action items' },
    { to: '/knowledge', label: 'Knowledge base' },
    { to: '/conflicts', label: 'Conflicts', count: conflicts.data?.length },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            Relay
          </NavLink>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `rounded-md px-3 py-1.5 ${isActive ? 'bg-teal-50 font-medium text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {n.label}
                {n.count ? <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-xs text-white">{n.count}</span> : null}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto text-xs text-slate-500" title="Whether the server has an AI key configured">
            AI: {health.data ? (health.data.ai === 'configured' ? <b className="text-emerald-700">on</b> : <b className="text-amber-700">off (fallback mode)</b>) : '…'}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/conflicts" element={<ConflictsPage />} />
          <Route path="*" element={<p className="text-sm text-slate-600">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
