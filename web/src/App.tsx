import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, auth, type Conflict, type Me } from './api';
import SessionsPage from './pages/Sessions';
import SessionPage from './pages/SessionDetail';
import ItemsPage from './pages/Items';
import KnowledgePage from './pages/Knowledge';
import ConflictsPage from './pages/Conflicts';
import SignIn from './pages/SignIn';
import { Avatar, Loading } from './ui';

export default function App() {
  const qc = useQueryClient();
  const [token, setToken] = useState(auth.get());
  useEffect(() => {
    const onAuth = () => {
      // A different user must never see the previous user's cached data.
      qc.clear();
      setToken(auth.get());
    };
    window.addEventListener('relay:auth', onAuth);
    return () => window.removeEventListener('relay:auth', onAuth);
  }, [qc]);

  if (!token) return <SignIn />;
  return <Shell />;
}

/** The signed-in user. Every page reads it from this cached query. */
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: Infinity });

function Shell() {
  const me = useMe();
  const conflicts = useQuery({ queryKey: ['conflicts', 'OPEN'], queryFn: () => api<Conflict[]>('/conflicts?status=OPEN') });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ ai: string }>('/health') });

  if (me.isLoading) return <Loading />;

  const nav = [
    { to: '/', label: 'Sessions', end: true },
    { to: '/items', label: 'Action items' },
    { to: '/knowledge', label: 'Knowledge base' },
    { to: '/conflicts', label: 'Conflicts', count: conflicts.data?.length },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
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
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span title="Whether the server has an AI key configured">
              AI: {health.data ? (health.data.ai === 'configured' ? <b className="text-emerald-700">on</b> : <b className="text-amber-700">off (fallback)</b>) : '…'}
            </span>
            {me.data && (
              <span className="flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-1 pr-1 text-slate-700">
                <Avatar name={me.data.name} size="sm" />
                <span>
                  <b>{me.data.name}</b> · {me.data.teams.map((t) => t.name).join(' + ') || 'no team'}
                </span>
                <button onClick={() => auth.set(null)} className="rounded-full bg-white px-2 py-0.5 font-medium text-teal-700 ring-1 ring-slate-200 hover:bg-teal-50">
                  Switch user
                </button>
              </span>
            )}
          </div>
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
