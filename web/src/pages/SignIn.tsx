import { useMutation, useQuery } from '@tanstack/react-query';
import { api, auth, type DemoPerson } from '../api';
import { Avatar, ErrorBox, Loading } from '../ui';

const FEATURES = [
  { icon: '✦', title: 'AI recap', text: 'Messy notes, chats or emails become a summary, decisions and owned action items you review before saving.' },
  { icon: '📨', title: 'Catch-up briefs', text: 'Missed the meeting or taking over? Get a brief written for you: your actions, decisions, what to watch.' },
  { icon: '↻', title: 'Nothing gets lost', text: 'Open items carry forward with full history and can only close with a recorded outcome.' },
  { icon: '⚠', title: 'Decision conflicts', text: 'Flags when a new decision quietly contradicts an older one, so nobody works from an outdated plan.' },
  { icon: '🔒', title: 'Right people only', text: 'Private, team and company visibility, enforced by the server and respected by the AI.' },
  { icon: '?', title: 'Ask Relay', text: 'Ask what the team decided and get an answer that cites the meeting or document it came from.' },
];

/** Landing + demo sign-in. Picking a person gets a real signed token; the server enforces access on every request. */
export default function SignIn() {
  const people = useQuery({ queryKey: ['demo-people'], queryFn: () => api<DemoPerson[]>('/auth/people') });
  const login = useMutation({
    mutationFn: (personId: string) => api<{ token: string }>('/auth/login', { method: 'POST', body: { personId } }),
    onSuccess: (r) => auth.set(r.token),
  });

  const teams = new Map<string, DemoPerson[]>();
  for (const p of people.data ?? []) for (const t of p.teams.length ? p.teams : [{ id: '-', name: 'No team' }]) teams.set(t.name, [...(teams.get(t.name) ?? []), p]);
  const recommended = people.data?.find((p) => p.name.startsWith('Priya'));

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/60 via-slate-50 to-slate-50">
      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1.1fr_1fr] lg:py-16">
        <section className="animate-rise">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-10 w-10" />
            <span className="text-2xl font-semibold tracking-tight text-slate-900">Relay</span>
          </div>
          <h1 className="mt-8 text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            Context that survives
            <br />
            <span className="text-teal-700">every hand-over.</span>
          </h1>
          <p className="mt-4 max-w-xl text-slate-600">
            Teams lose context when work changes hands: a missed meeting, a colleague on leave, last week's action item that never reaches this week's
            agenda. Relay captures what was decided, hands it to the right people and follows every item until it is closed.
          </p>
          <a href="#demo" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 lg:hidden">
            Try the live demo ↓
          </a>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-sm shadow-sm ring-1 ring-slate-200">
                  {f.icon}
                </span>
                <span>
                  <b className="block text-sm text-slate-900">{f.title}</b>
                  <span className="text-sm text-slate-600">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-slate-500">
            React · Node/Express · TypeScript · PostgreSQL · Gemini ·{' '}
            <a className="font-medium text-teal-700 underline-offset-2 hover:underline" href="https://github.com/Soham-dotcom/relay" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </p>
        </section>

        <section id="demo" className="animate-rise scroll-mt-4 self-start rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" style={{ animationDelay: '80ms' }}>
          <h2 className="text-lg font-semibold text-slate-900">Try the live demo</h2>
          <p className="mt-1 text-sm text-slate-600">
            Pick anyone in this demo company, no password. Each person sees only what their teams, their meetings and the whole company share, so
            switching people shows the access rules at work.
          </p>

          {recommended && (
            <button
              onClick={() => login.mutate(recommended.id)}
              disabled={login.isPending}
              className="mt-4 flex w-full items-center gap-3 rounded-xl bg-teal-700 p-3 text-left text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
            >
              <Avatar name={recommended.name} size="lg" />
              <span className="flex-1">
                <span className="block font-semibold">Start as {recommended.name}</span>
                <span className="block text-xs text-teal-100">Engineering lead · sees the most, including a private hand-over</span>
              </span>
              <span aria-hidden className="text-xl">→</span>
            </button>
          )}

          {people.isLoading && <Loading />}
          <div className="mt-3">
            <ErrorBox error={people.error ?? login.error} />
          </div>

          <div className="mt-5 space-y-5">
            {[...teams.entries()].map(([team, members]) => (
              <div key={team}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{team}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {members
                    .filter((p) => p.id !== recommended?.id || team !== 'Payments squad')
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => login.mutate(p.id)}
                        disabled={login.isPending}
                        className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-2.5 text-left transition hover:border-teal-500 hover:bg-teal-50/40 disabled:opacity-50"
                      >
                        <Avatar name={p.name} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {p.role}
                            {p.teams.length > 1 && ' · both teams'}
                          </span>
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
