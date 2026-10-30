import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type ItemStatus, type SessionStatus, type Visibility } from './api';

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const isOverdue = (due: string | null, status: ItemStatus) =>
  Boolean(due && new Date(due) < new Date() && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(status));

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
const variants: Record<Variant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50',
  ai: 'bg-violet-600 text-white hover:bg-violet-700',
};

export function Button({ variant = 'primary', busy, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const statusStyle: Record<ItemStatus | SessionStatus, string> = {
  OPEN: 'bg-sky-50 text-sky-700 ring-sky-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-800 ring-amber-200',
  BLOCKED: 'bg-red-50 text-red-700 ring-red-200',
  DONE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  DROPPED: 'bg-slate-100 text-slate-600 ring-slate-200',
  PLANNED: 'bg-sky-50 text-sky-700 ring-sky-200',
  HELD: 'bg-amber-50 text-amber-800 ring-amber-200',
  CLOSED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone ?? 'bg-slate-100 text-slate-700 ring-slate-200'}`}>{children}</span>;
}

const visibilityInfo: Record<Visibility, { icon: string; label: string; tone: string; hint: string }> = {
  PRIVATE: { icon: '🔒', label: 'Private', tone: 'bg-rose-50 text-rose-800 ring-rose-200', hint: 'Only the participants (or the author) can see this' },
  TEAM: { icon: '👥', label: 'Team', tone: 'bg-slate-100 text-slate-700 ring-slate-200', hint: 'Members of the team can see this' },
  ORG: { icon: '🌐', label: 'Organisation', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200', hint: 'Everyone in the company can see this' },
};

export function VisibilityBadge({ visibility, team }: { visibility: Visibility; team?: { name: string } | null }) {
  const v = visibilityInfo[visibility];
  return (
    <span title={v.hint}>
      <Badge tone={v.tone}>
        {v.icon} {visibility === 'TEAM' && team ? team.name : v.label}
      </Badge>
    </span>
  );
}

/** Radio group for choosing who can see a new session or document. */
export function VisibilityPicker({ value, onChange, privateHint }: { value: Visibility; onChange: (v: Visibility) => void; privateHint: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who can see this">
      {(['PRIVATE', 'TEAM', 'ORG'] as const).map((k) => {
        const v = visibilityInfo[k];
        return (
          <button
            type="button"
            key={k}
            role="radio"
            aria-checked={value === k}
            onClick={() => onChange(k)}
            className={`rounded-md border px-3 py-2 text-left text-sm ${value === k ? 'border-teal-600 bg-teal-50' : 'border-slate-200'}`}
          >
            <b>
              {v.icon} {v.label}
            </b>
            <span className="block text-xs text-slate-600">{k === 'PRIVATE' ? privateHint : v.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

const avatarTones = ['bg-teal-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-emerald-600', 'bg-indigo-600'];

/** Coloured initials. The colour comes from the name, so a person keeps the same colour everywhere. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const dims = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-10 w-10 text-sm' }[size];
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white ${dims} ${avatarTones[h % avatarTones.length]}`}>
      {initials}
    </span>
  );
}

export function AvatarStack({ names, max = 5 }: { names: string[]; max?: number }) {
  return (
    <span className="flex items-center -space-x-1.5" title={names.join(', ')}>
      {names.slice(0, max).map((n) => (
        <Avatar key={n} name={n} size="sm" />
      ))}
      {names.length > max && <span className="pl-3 text-xs text-slate-500">+{names.length - max}</span>}
    </span>
  );
}

export function Stat({ label, value, tone = 'text-slate-900', hint }: { label: string; value: number | string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3" title={hint}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

export const StatusBadge =({ status }: { status: ItemStatus | SessionStatus }) => <Badge tone={statusStyle[status]}>{status.replace('_', ' ').toLowerCase()}</Badge>;

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p className="font-medium">{e?.code === 'AI_UNAVAILABLE' ? 'AI is unavailable right now. You can retry or enter the details by hand.' : (error as Error).message}</p>
      {e?.details?.length ? (
        <ul className="mt-1 list-disc pl-5">
          {e.details.map((d) => (
            <li key={d.path + d.message}>
              {d.path && <b>{d.path}: </b>}
              {d.message}
            </li>
          ))}
        </ul>
      ) : null}
      {e?.requestId && (
        <p className="mt-1 text-xs text-red-600">
          Request ID: <Link className="font-mono underline" to={`/activity?rid=${e.requestId}`}>{e.requestId}</Link> (see what happened)
        </p>
      )}
    </div>
  );
}

export const Loading = () => <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-slate-500">{children}</p>;

export const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-10" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className="w-full max-w-2xl rounded-lg bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
