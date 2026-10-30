import { useMutation, useQuery } from '@tanstack/react-query';
import { api, auth, type DemoPerson } from '../api';
import { Avatar, ErrorBox, Loading } from '../ui';

/** Demo sign-in: pick a person. The server still issues a signed token and enforces access on every request. */
export default function SignIn() {
  const people = useQuery({ queryKey: ['demo-people'], queryFn: () => api<DemoPerson[]>('/auth/people') });
  const login = useMutation({
    mutationFn: (personId: string) => api<{ token: string }>('/auth/login', { method: 'POST', body: { personId } }),
    onSuccess: (r) => auth.set(r.token),
  });

  const teams = new Map<string, DemoPerson[]>();
  for (const p of people.data ?? []) for (const t of p.teams.length ? p.teams : [{ id: '-', name: 'No team' }]) teams.set(t.name, [...(teams.get(t.name) ?? []), p]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <img src="/favicon.svg" alt="" className="h-10 w-10" />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Relay</h1>
          <p className="text-sm text-slate-600">AI hand-over for meetings and work transfers</p>
        </div>
      </div>
      <h2 className="font-medium text-slate-900">Sign in as a demo user</h2>
      <p className="mt-1 text-sm text-slate-600">
        Each person sees only what their teams, their meetings and the whole company share. Switch people to see private and team-only content
        appear and disappear. People in two teams (Neha) see both.
      </p>
      {people.isLoading && <Loading />}
      <div className="mt-3">
        <ErrorBox error={people.error ?? login.error} />
      </div>
      <div className="mt-6 space-y-6">
        {[...teams.entries()].map(([team, members]) => (
          <section key={team}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{team}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {members.map((p) => (
                <button
                  key={p.id}
                  onClick={() => login.mutate(p.id)}
                  disabled={login.isPending}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-teal-500 hover:shadow-md disabled:opacity-50"
                >
                  <Avatar name={p.name} size="lg" />
                  <span>
                    <span className="block font-medium text-slate-900">{p.name}</span>
                    <span className="block text-xs text-slate-500">
                      {p.role} · {p.teams.map((t) => t.name).join(' + ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
