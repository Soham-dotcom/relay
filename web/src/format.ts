import type { ItemStatus } from './api';

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const isOverdue = (due: string | null, status: ItemStatus) =>
  Boolean(due && new Date(due) < new Date() && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(status));
